# Basic Docker Compose App

A minimal, production-style Docker Compose stack that runs an Express API behind an nginx reverse proxy, with PostgreSQL and pgAdmin.

## What we achieved

- Containerized a Node.js API with a multi-stage Dockerfile and non-root runtime
- Provisioned PostgreSQL with a healthcheck and persistent volume
- Added pgAdmin for database inspection and troubleshooting
- Added nginx as a reverse proxy — the API is not directly exposed to the host
- Wired everything together with Docker Compose and environment-based configuration

## Services and ports

- **nginx**: http://localhost:80 (proxies to API internally)
- **API**: internal only on port 3000 (not exposed to host)
- **pgAdmin**: http://localhost:5050
- **PostgreSQL**: internal on port 5432

## Prerequisites

- Docker Desktop (or Docker Engine with Compose v2)

## Setup

1. Create your environment file:
   - Windows: `copy .env.example .env`
   - macOS/Linux: `cp .env.example .env`
2. Fill in:
   - `POSTGRES_DB`
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `PGADMIN_EMAIL`
   - `PGADMIN_PASSWORD`

## Run

```bash
docker compose up --build
```

## API endpoints

- `GET /health` → service health
- `GET /messages` → list messages
- `POST /messages` → create a message
  - Body: `{ "text": "hello" }`

Example:

```bash
curl -X POST http://localhost/messages ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"hello\"}"
```

## pgAdmin connection details

When creating the server in pgAdmin, use:

- **Host**: `db`
- **Port**: `5432`
- **Database**: `POSTGRES_DB`
- **Username**: `POSTGRES_USER`
- **Password**: `POSTGRES_PASSWORD`

## Data persistence

PostgreSQL data is stored in the `postgres-data` Docker volume, so it persists across restarts.
