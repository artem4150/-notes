package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"notes-backend/internal/config"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	cfg    config.Config
	db     *pgxpool.Pool
	router http.Handler
}

type sessionContextKey string

const sessionTokenKey sessionContextKey = "sessionToken"

func New(ctx context.Context, cfg config.Config) (*Server, error) {
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect db: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.Ping(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	if err := runMigrations(ctx, db, cfg.MigrationsDir); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrations: %w", err)
	}

	s := &Server{cfg: cfg, db: db}
	s.mountRoutes()
	return s, nil
}

func (s *Server) Handler() http.Handler {
	return s.router
}

func (s *Server) Close() {
	s.db.Close()
}

func (s *Server) mountRoutes() {
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/auth", func(r chi.Router) {
		r.Post("/login", s.handleLogin)
		r.Post("/logout", s.handleLogout)
		r.Get("/session", s.handleSessionStatus)
	})

	r.Group(func(r chi.Router) {
		r.Use(s.requireSession)
		r.Get("/notes", s.handleListNotes)
		r.Post("/notes", s.handleCreateNote)
		r.Get("/notes/{id}", s.handleGetNote)
		r.Put("/notes/{id}", s.handleUpdateNote)
		r.Delete("/notes/{id}", s.handleDeleteNote)
		r.Post("/notes/{id}/favorite", s.handleFavoriteNote)
	})

	s.router = r
}

func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(s.cfg.SessionCookieName)
		if err != nil || strings.TrimSpace(cookie.Value) == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		token := strings.TrimSpace(cookie.Value)
		var exists bool
		err = s.db.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1
				FROM sessions
				WHERE token = $1
				  AND expires_at > NOW()
			)
		`, token).Scan(&exists)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		if !exists {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		ctx := context.WithValue(r.Context(), sessionTokenKey, token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	type request struct {
		Password string `json:"password"`
	}

	var req request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	if subtle.ConstantTimeCompare([]byte(req.Password), []byte(s.cfg.AppPassword)) != 1 {
		writeError(w, http.StatusUnauthorized, "invalid password")
		return
	}

	token, err := generateSessionToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create session")
		return
	}

	expiresAt := time.Now().Add(s.cfg.SessionTTL)
	_, err = s.db.Exec(r.Context(), `
		INSERT INTO sessions (id, token, expires_at)
		VALUES ($1, $2, $3)
	`, uuid.New(), token, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	s.setSessionCookie(w, token, expiresAt)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(s.cfg.SessionCookieName)
	if err == nil && strings.TrimSpace(cookie.Value) != "" {
		_, _ = s.db.Exec(r.Context(), `DELETE FROM sessions WHERE token = $1`, cookie.Value)
	}
	s.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleSessionStatus(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(s.cfg.SessionCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}

	var exists bool
	err = s.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1
			FROM sessions
			WHERE token = $1
			  AND expires_at > NOW()
		)
	`, cookie.Value).Scan(&exists)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if !exists {
		s.clearSessionCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true})
}

type note struct {
	ID         uuid.UUID `json:"id"`
	Title      string    `json:"title"`
	Content    string    `json:"content"`
	Tags       []string  `json:"tags"`
	IsFavorite bool      `json:"is_favorite"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (s *Server) handleListNotes(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))

	var favorite *bool
	favoriteRaw := strings.TrimSpace(r.URL.Query().Get("favorite"))
	if favoriteRaw != "" {
		parsed, err := strconv.ParseBool(favoriteRaw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "favorite must be true or false")
			return
		}
		favorite = &parsed
	}

	page := parsePositiveInt(r.URL.Query().Get("page"), 1)
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 30)
	if limit > 100 {
		limit = 100
	}
	offset := (page - 1) * limit

	countQuery := `
		SELECT COUNT(*)
		FROM notes
		WHERE ($1 = '' OR title ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR $2 = ANY(tags))
		  AND ($3::boolean IS NULL OR is_favorite = $3)
	`

	var total int
	if err := s.db.QueryRow(r.Context(), countQuery, query, tag, favorite).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	rows, err := s.db.Query(r.Context(), `
		SELECT id, title, content, tags, is_favorite, created_at, updated_at
		FROM notes
		WHERE ($1 = '' OR title ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR $2 = ANY(tags))
		  AND ($3::boolean IS NULL OR is_favorite = $3)
		ORDER BY updated_at DESC
		LIMIT $4 OFFSET $5
	`, query, tag, favorite, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer rows.Close()

	items := make([]note, 0, limit)
	for rows.Next() {
		var n note
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.Tags, &n.IsFavorite, &n.CreatedAt, &n.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		items = append(items, n)
	}
	if rows.Err() != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"page":  page,
		"limit": limit,
		"total": total,
	})
}

func (s *Server) handleGetNote(w http.ResponseWriter, r *http.Request) {
	noteID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var n note
	err = s.db.QueryRow(r.Context(), `
		SELECT id, title, content, tags, is_favorite, created_at, updated_at
		FROM notes
		WHERE id = $1
	`, noteID).Scan(&n.ID, &n.Title, &n.Content, &n.Tags, &n.IsFavorite, &n.CreatedAt, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	writeJSON(w, http.StatusOK, n)
}

func (s *Server) handleCreateNote(w http.ResponseWriter, r *http.Request) {
	type request struct {
		Title      string   `json:"title"`
		Content    string   `json:"content"`
		Tags       []string `json:"tags"`
		IsFavorite bool     `json:"is_favorite"`
	}

	var req request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Untitled"
	}
	content := req.Content
	tags := sanitizeTags(req.Tags)

	var n note
	err := s.db.QueryRow(r.Context(), `
		INSERT INTO notes (id, title, content, tags, is_favorite)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, title, content, tags, is_favorite, created_at, updated_at
	`, uuid.New(), title, content, tags, req.IsFavorite).Scan(
		&n.ID,
		&n.Title,
		&n.Content,
		&n.Tags,
		&n.IsFavorite,
		&n.CreatedAt,
		&n.UpdatedAt,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	writeJSON(w, http.StatusCreated, n)
}

func (s *Server) handleUpdateNote(w http.ResponseWriter, r *http.Request) {
	noteID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	type request struct {
		Title      string   `json:"title"`
		Content    string   `json:"content"`
		Tags       []string `json:"tags"`
		IsFavorite bool     `json:"is_favorite"`
	}

	var req request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Untitled"
	}
	tags := sanitizeTags(req.Tags)

	var n note
	err = s.db.QueryRow(r.Context(), `
		UPDATE notes
		SET title = $2,
		    content = $3,
		    tags = $4,
		    is_favorite = $5,
		    updated_at = NOW()
		WHERE id = $1
		RETURNING id, title, content, tags, is_favorite, created_at, updated_at
	`, noteID, title, req.Content, tags, req.IsFavorite).Scan(
		&n.ID,
		&n.Title,
		&n.Content,
		&n.Tags,
		&n.IsFavorite,
		&n.CreatedAt,
		&n.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	writeJSON(w, http.StatusOK, n)
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
	noteID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.db.Exec(r.Context(), `DELETE FROM notes WHERE id = $1`, noteID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleFavoriteNote(w http.ResponseWriter, r *http.Request) {
	noteID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	type request struct {
		Value bool `json:"value"`
	}
	var req request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	var n note
	err = s.db.QueryRow(r.Context(), `
		UPDATE notes
		SET is_favorite = $2,
		    updated_at = NOW()
		WHERE id = $1
		RETURNING id, title, content, tags, is_favorite, created_at, updated_at
	`, noteID, req.Value).Scan(
		&n.ID,
		&n.Title,
		&n.Content,
		&n.Tags,
		&n.IsFavorite,
		&n.CreatedAt,
		&n.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	writeJSON(w, http.StatusOK, n)
}

func generateSessionToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     s.cfg.SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   s.cfg.CookieDomain,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     s.cfg.SessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   s.cfg.CookieDomain,
	})
}

func parseUUIDParam(r *http.Request, name string) (uuid.UUID, error) {
	raw := chi.URLParam(r, name)
	if raw == "" {
		return uuid.Nil, fmt.Errorf("%s is required", name)
	}
	parsed, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid %s", name)
	}
	return parsed, nil
}

func parsePositiveInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func sanitizeTags(tags []string) []string {
	if len(tags) == 0 {
		return []string{}
	}
	uniq := make(map[string]struct{}, len(tags))
	clean := make([]string, 0, len(tags))
	for _, tag := range tags {
		t := strings.ToLower(strings.TrimSpace(tag))
		if t == "" {
			continue
		}
		if len(t) > 32 {
			t = t[:32]
		}
		if _, exists := uniq[t]; exists {
			continue
		}
		uniq[t] = struct{}{}
		clean = append(clean, t)
	}
	return clean
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
