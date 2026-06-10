# Production-Grade Docker Compose Stack

A fully containerized, production-style web application stack: Node.js/Express API behind an nginx reverse proxy, backed by PostgreSQL — with pgAdmin for database management and a GitHub Actions CI/CD pipeline that builds and publishes images to Docker Hub on every push.

## Architecture

```
                  ┌─────────────┐
         :80      │             │
  Host ──────────▶│    nginx    │  reverse proxy
                  │             │
                  └──────┬──────┘
                         │ internal :3000
                  ┌──────▼──────┐
                  │             │
                  │   Express   │  Node.js API
                  │     API     │
                  │             │
                  └──────┬──────┘
                         │ internal :5432
                  ┌──────▼──────┐
                  │             │
                  │  PostgreSQL │  persistent volume
                  │             │
                  └─────────────┘

  pgAdmin (:5050) ──────────────▶ PostgreSQL (internal)
  Prometheus (:9090) ───────────▶ API /metrics (internal)
  Grafana (:3001) ──────────────▶ Prometheus (internal)
```

All inter-service traffic runs on an isolated bridge network. The API is never directly exposed to the host.
Prometheus scrapes API metrics over the internal network, and Grafana reads from Prometheus.
The `/metrics` endpoint is blocked at the nginx layer with `deny all`, so it is only reachable from inside the Docker network.
Service startup order is enforced by healthchecks: PostgreSQL must pass `pg_isready`, then the API must pass `/health`, and only then nginx starts.

## What's inside

### API (`api/`)
- Node.js 20 + Express, connecting to PostgreSQL via `pg`
- Auto-creates the `messages` table on startup
- Exposes Prometheus metrics for request totals, latency, active connections, and process memory
- Built with a **multi-stage Dockerfile**: dependencies installed in a `node:20-alpine` builder stage, runtime image based on `alpine:3.22.4` with only Node.js added — no npm, no shell extras
- Runs as a **non-root user** (`node`) for container security
- Built-in **Docker healthcheck** via `wget` on `/health`

### nginx (`nginx/`)
- Alpine-based reverse proxy, the only service with a host-facing port
- Forwards `X-Real-IP` and `X-Forwarded-For` headers
- Starts only after the API passes its healthcheck (`depends_on: condition: service_healthy`)

### PostgreSQL
- Postgres 16 Alpine with a `pg_isready` healthcheck
- Data persisted to a named Docker volume (`postgres-data`) — survives restarts and re-deploys

### pgAdmin
- Web UI for inspecting and querying the database
- Accessible at [http://localhost:5050](http://localhost:5050)
- Credentials configured via environment variables

### Prometheus (`prometheus/`)
- Scrapes API metrics from `/metrics` every 15s (internal only)
- Uses `prometheus/prometheus.yml` for configuration
- Stores time-series data in the `prometheus-data` volume
- Retains data for 7 days
- Accessible at [http://localhost:9090](http://localhost:9090)

### Grafana
- Visualization UI for Prometheus metrics
- Accessible at [http://localhost:3001](http://localhost:3001)
- Credentials configured via environment variables
- User sign-up disabled by default (`GF_USERS_ALLOW_SIGN_UP=false`)

### CI/CD (`.github/workflows/docker-build-push.yml`)
- Triggers on every push to `main`
- Logs into Docker Hub using repository secrets
- Builds with **Docker Buildx** and **GitHub Actions cache** (`type=gha`) for fast incremental builds
- Pushes two tags: `latest` and the full commit SHA (`nitink2306/docker-compose-app:<sha>`)

## Services and ports

| Service    | Host port | Internal port | Notes                          |
|------------|-----------|---------------|--------------------------------|
| nginx      | 80        | 80            | Entry point for all API traffic |
| API        | —         | 3000          | Not exposed to host            |
| PostgreSQL | —         | 5432          | Not exposed to host            |
| pgAdmin    | 5050      | 80            | Database admin UI              |
| Prometheus | 9090      | 9090          | Metrics scraping/storage       |
| Grafana    | 3001      | 3000          | Metrics dashboards             |

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)

## Environment variables

Copy the example env file and fill in the values:

- Windows: `copy .env.example .env`
- macOS/Linux: `cp .env.example .env`

```env
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
PGADMIN_EMAIL=
PGADMIN_PASSWORD=
GF_SECURITY_ADMIN_USER=
GF_SECURITY_ADMIN_PASSWORD=
```

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

## Run

```bash
docker compose up --build
```

Docker Compose will start services in dependency order: PostgreSQL first, then the API (after the DB healthcheck passes), then nginx (after the API healthcheck passes).

To use the published Docker Hub image instead of building locally:

```bash
docker compose pull api
docker compose up -d
```

To run in the background:

```bash
docker compose up -d --build
```

To stop and remove containers (data volume is preserved):

```bash
docker compose down
```

## API Implementation

- `createApp(pool)` in `api/index.js` builds and returns the Express app, using dependency injection so tests can pass a mock pool without a real PostgreSQL instance.
- The boot block (`require.main === module`) creates the real `pg.Pool` from environment variables and starts the HTTP server on port 3000; this block is skipped when required by tests.
- `api/metrics.js` is the single source of truth for Prometheus metric definitions, and `index.js` only imports and records them.
- The memory metrics interval inside `createApp` uses `.unref()` so the timer does not keep Node running after tests complete.
- Express 5 async route handlers propagate rejected promises to the error handler automatically, so route-level `try/catch` is generally unnecessary.

## Testing

Tests live in `api/index.test.js` and run with Node's built-in test runner (`node --test`) plus `supertest` and an inline `mockPool`.
The mock pool handles SELECT and INSERT SQL patterns using string matching, so no real database or running server is required.

## Docker image

- Multi-stage build: `node:20-alpine` builder installs production dependencies, then `alpine:3.22.4` runtime adds only `nodejs`.
- Runtime image intentionally excludes npm and shell extras to keep the image small and reduce attack surface.
- The final image copies only `index.js`, `metrics.js`, and `node_modules`.
- The application runs as the non-root `node` user.

## API endpoints

| Method | Path       | Description         |
|--------|------------|---------------------|
| GET    | /health    | Service health check |
| GET    | /messages  | List all messages (newest first) |
| POST   | /messages  | Create a message    |
| GET    | /metrics   | Prometheus metrics (internal only) |

The `/metrics` endpoint is blocked at the nginx layer, so it is reachable only from inside the Docker network (Prometheus).

### Examples

```bash
# Health check
curl http://localhost/health

# List messages
curl http://localhost/messages

# Create a message
curl -X POST http://localhost/messages \
  -H "Content-Type: application/json" \
  -d '{"text": "hello"}'
```

Windows (cmd):

```cmd
curl -X POST http://localhost/messages ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"hello\"}"
```

## pgAdmin setup

1. Open [http://localhost:5050](http://localhost:5050) and log in with your `PGADMIN_EMAIL` / `PGADMIN_PASSWORD`
2. Add a new server with these connection details:

| Field    | Value             |
|----------|-------------------|
| Host     | `db`              |
| Port     | `5432`            |
| Database | your `POSTGRES_DB` value |
| Username | your `POSTGRES_USER` value |
| Password | your `POSTGRES_PASSWORD` value |

## CI/CD setup (Docker Hub)

The GitHub Actions workflow requires two repository secrets:

| Secret           | Value                          |
|------------------|--------------------------------|
| `DOCKER_USERNAME` | Your Docker Hub username      |
| `DOCKER_TOKEN`   | A Docker Hub access token (not your password) |

Set these under **Settings → Secrets and variables → Actions** in your GitHub repository.

## Data persistence

PostgreSQL data lives in the `postgres-data` named volume. Prometheus and Grafana store data in the `prometheus-data` and `grafana-data` volumes. These volumes survive `docker compose down` and are only removed with:

```bash
docker compose down -v
```
