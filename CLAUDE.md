# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run the full stack:**
```bash
docker compose up --build          # foreground
docker compose up -d --build       # background
docker compose down                # stop (data volumes preserved)
docker compose down -v             # stop and delete volumes
```

**API tests** (no Docker required — uses a mock pool):
```bash
cd api && node --test
```

**Exercise the API** (stack must be running):
```bash
curl http://localhost/health
curl http://localhost/messages
curl -X POST http://localhost/messages -H "Content-Type: application/json" -d '{"text":"hello"}'
```

## Architecture

```
Host :80 → nginx → api:3000 (Express) → db:5432 (PostgreSQL)
Prometheus → api:3000/metrics (direct, bypasses nginx)
Grafana → Prometheus
pgAdmin → db:5432
```

All services share the `app-network` bridge. The API is never exposed directly to the host — only nginx has a host-facing port (80). The `/metrics` endpoint is blocked at the nginx layer (`deny all`) so it is reachable only from within the Docker network (Prometheus scrapes it directly at `api:3000`).

Startup order is enforced by healthchecks: PostgreSQL → API (`/health` must pass) → nginx.

## API (`api/`)

**`createApp(pool)`** — factory function in `index.js`. Builds and returns the Express app. Accepts a `pool` argument (dependency injection) so tests can pass a mock without a real Postgres instance.

**Boot block** (`require.main === module`) — creates the real `pg.Pool` from env vars and starts the HTTP server on port 3000. Skipped entirely when the file is `require()`'d by tests.

**`metrics.js`** — single source of truth for all Prometheus metric definitions (Counter, Gauge, Histogram). `index.js` imports and records values; it never defines metrics itself.

**Memory metrics interval** in `createApp` uses `.unref()` so the timer doesn't prevent Node from exiting cleanly after tests finish.

**Express 5** is used — async route handlers propagate rejected promises to the error handler automatically; no `try/catch` needed in routes (except `/metrics` where the error response format matters).

## Testing

Tests live in `api/index.test.js` and use Node's built-in test runner (`node --test`) with `supertest` and an inline `mockPool`. The mock handles SELECT and INSERT SQL patterns by string matching. No real database or running server is needed.

## Docker image

Multi-stage build: `node:20-alpine` builder installs production deps; `alpine:3.22.4` runtime adds only `nodejs` (no npm, no shell extras). The app runs as the non-root `node` user. Only `index.js`, `metrics.js`, and `node_modules` are copied into the final image.

## CI/CD

`.github/workflows/docker-build-push.yml` triggers on push to `main`. Builds with Docker Buildx + GitHub Actions cache (`type=gha`) and pushes two tags to Docker Hub: `latest` and the full commit SHA. Requires `DOCKER_USERNAME` and `DOCKER_TOKEN` repository secrets.

## Environment

Copy `.env.example` to `.env` and fill in: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `PGADMIN_EMAIL`, `PGADMIN_PASSWORD`, `GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD`.
