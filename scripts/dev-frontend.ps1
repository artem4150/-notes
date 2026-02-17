Set-Location (Join-Path $PSScriptRoot "..\frontend")
if (-not $env:API_BACKEND_URL) {
  $env:API_BACKEND_URL = "http://localhost:8080"
}
if (-not $env:NEXT_PUBLIC_SESSION_COOKIE_NAME) {
  $env:NEXT_PUBLIC_SESSION_COOKIE_NAME = "notes_session"
}
npm run dev