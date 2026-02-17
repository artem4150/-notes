package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port              string
	DatabaseURL       string
	AppPassword       string
	SessionCookieName string
	SessionTTL        time.Duration
	CookieSecure      bool
	CookieDomain      string
	AllowedOrigin     string
	MigrationsDir     string
}

func Load() (Config, error) {
	sessionHours := getEnv("SESSION_TTL_HOURS", "168")
	hours, err := strconv.Atoi(sessionHours)
	if err != nil || hours <= 0 {
		return Config{}, fmt.Errorf("invalid SESSION_TTL_HOURS: %q", sessionHours)
	}

	cfg := Config{
		Port:              getEnv("PORT", "8080"),
		DatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),
		AppPassword:       strings.TrimSpace(os.Getenv("APP_PASSWORD")),
		SessionCookieName: getEnv("SESSION_COOKIE_NAME", "notes_session"),
		SessionTTL:        time.Duration(hours) * time.Hour,
		CookieSecure:      strings.EqualFold(getEnv("SESSION_COOKIE_SECURE", "false"), "true"),
		CookieDomain:      strings.TrimSpace(os.Getenv("SESSION_COOKIE_DOMAIN")),
		AllowedOrigin:     strings.TrimSpace(os.Getenv("ALLOWED_ORIGIN")),
		MigrationsDir:     getEnv("MIGRATIONS_DIR", "../db/migrations"),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.AppPassword == "" {
		return Config{}, fmt.Errorf("APP_PASSWORD is required")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
