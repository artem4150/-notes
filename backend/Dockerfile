FROM golang:1.23-alpine AS builder
WORKDIR /app

COPY backend/go.mod backend/go.sum* ./backend/
WORKDIR /app/backend
RUN go mod download

COPY backend /app/backend
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /app/bin/server ./cmd/server

FROM alpine:3.20
WORKDIR /app
RUN adduser -D -u 10001 appuser

COPY --from=builder /app/bin/server /app/server
COPY db/migrations /app/migrations

USER appuser
EXPOSE 8080
CMD ["/app/server"]