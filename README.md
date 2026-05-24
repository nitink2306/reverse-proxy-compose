# Basic Docker Compose App

A minimal, production-style Docker Compose stack that runs an Express API with PostgreSQL and pgAdmin.

## What we achieved

- Containerized a Node.js API with a multi-stage Dockerfile and non-root runtime
- Provisioned PostgreSQL with a healthcheck and persistent volume
- Added pgAdmin for database inspection and troubleshooting
- Wired everything together with Docker Compose and environment-based configuration

## Services and ports

- **API**: http://localhost:8080 (container port 3000)
- **pgAdmin**: http://localhost:5050 (container port 80)
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
curl -X POST http://localhost:8080/messages ^
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
