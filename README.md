# Production-Grade Docker Compose Stack

A fully containerized, production-style web application stack: Node.js/Express API behind an nginx reverse proxy, backed by PostgreSQL — with pgAdmin for database management and a two-stage GitHub Actions CI/CD pipeline: a CI workflow runs ESLint and the full test suite on every push and PR; a separate CD workflow builds and publishes multi-platform Docker images to Docker Hub only after CI passes.

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

### CI (`.github/workflows/ci.yml`)
- Triggers on every push to any branch and every PR targeting `main`
- Runs **ESLint** (static analysis) then the **full test suite with coverage** (`node --experimental-test-coverage --test`)
- A lint error or failing test blocks all further pipeline stages — nothing ships broken code

### CD (`.github/workflows/docker-build-push.yml`)
- Triggers only after CI passes on `main` (via `workflow_run`) — never runs on a broken commit
- Builds **multi-platform images** (`linux/amd64`, `linux/arm64`) with Docker Buildx and GitHub Actions cache (`type=gha`)
- Pushes two tags to Docker Hub: `latest` and the full commit SHA (`nitink2306/docker-compose-app:<sha>`)

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

## Setup

1. Copy the example env file:
   - Windows: `copy .env.example .env`
   - macOS/Linux: `cp .env.example .env`

2. Fill in the values:

```env
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
PGADMIN_EMAIL=
PGADMIN_PASSWORD=
GF_SECURITY_ADMIN_USER=
GF_SECURITY_ADMIN_PASSWORD=
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

## CI/CD setup

The CD workflow requires two repository secrets to push images to Docker Hub:

| Secret            | Value                                          |
|-------------------|------------------------------------------------|
| `DOCKER_USERNAME` | Your Docker Hub username                       |
| `DOCKER_TOKEN`    | A Docker Hub access token (not your password)  |

The CI workflow runs automatically with no additional secrets — it uses the built-in `GITHUB_TOKEN`.

Set secrets under **Settings → Secrets and variables → Actions** in your GitHub repository.

## Data persistence

PostgreSQL data lives in the `postgres-data` named volume. Prometheus and Grafana store data in the `prometheus-data` and `grafana-data` volumes. These volumes survive `docker compose down` and are only removed with:

```bash
docker compose down -v
```
