# Markdown Notes / Paste MVP

Monorepo personal markdown notes service:
- `frontend`: Next.js App Router + TypeScript + Tailwind + shadcn/ui
- `backend`: Go (Chi) + pgx/pgxpool REST API
- `db/migrations`: SQL migrations
- `docker-compose.yml`: production-like local deployment

## Features

- Password login without registration (`httpOnly` cookie session)
- Notes CRUD: title, markdown content, tags, favorite
- Sidebar with search, tags filter, favorites filter
- Split view Editor/Preview (desktop), tabbed view (mobile)
- Autosave with 720ms debounce + save status text
- Unsaved changes browser-leave warning
- Markdown preview with sanitize + `rehype-pretty-code`
- Code blocks with language label + copy button
- Light/Dark/System themes

## Project Structure

```text
.
+-- backend
¦   +-- cmd/server/main.go
¦   +-- internal
¦   L-- Dockerfile
+-- db
¦   L-- migrations
¦       L-- 001_init.sql
+-- frontend
¦   +-- app
¦   +-- components
¦   +-- lib
¦   L-- Dockerfile
+-- docker-compose.yml
L-- .env.example
```

## Environment

Copy `.env.example` to `.env` and change values:

```bash
cp .env.example .env
```

Required:
- `APP_PASSWORD` - shared password for login.

## Run with Docker

```bash
docker compose --env-file .env up --build
```

Services:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080`
- Postgres: `localhost:5432`

Migrations are applied automatically on backend startup from `/app/migrations`.

## Local Development (without Docker)

1. Start Postgres manually (or with compose):

```bash
docker compose --env-file .env up -d postgres
```

2. Start backend:

```powershell
./scripts/dev-backend.ps1
```

3. Start frontend:

```powershell
./scripts/dev-frontend.ps1
```

Frontend uses Next.js rewrite `/api/* -> backend` (`API_BACKEND_URL`, default `http://localhost:8080`).

## Useful Commands

```bash
# backend format/check
cd backend
go fmt ./...
go test ./...

# frontend lint/build
cd frontend
npm run lint
npm run build
```

## API

- `POST /auth/login` `{ password }`
- `POST /auth/logout`
- `GET /auth/session`
- `GET /notes?query=&tag=&favorite=&page=&limit=`
- `POST /notes`
- `GET /notes/:id`
- `PUT /notes/:id`
- `DELETE /notes/:id`
- `POST /notes/:id/favorite` `{ value: boolean }`