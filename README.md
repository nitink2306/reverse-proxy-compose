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
```

All inter-service traffic runs on an isolated bridge network. The API is never directly exposed to the host.

## What's inside

### API (`api/`)
- Node.js 20 + Express, connecting to PostgreSQL via `pg`
- Auto-creates the `messages` table on startup
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
```

## Run

```bash
docker compose up --build
```

Docker Compose will start services in dependency order: PostgreSQL first, then the API (after the DB healthcheck passes), then nginx (after the API healthcheck passes).

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

PostgreSQL data lives in the `postgres-data` named volume. It survives `docker compose down` and is only removed with:

```bash
docker compose down -v
```
