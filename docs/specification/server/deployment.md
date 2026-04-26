# Server Deployment

## Running Directly

```bash
pnpm install
pnpm --filter @manifesto/server build
pnpm --filter @manifesto/server start
```

## Docker

The Dockerfile lives at `packages/server/Dockerfile`. Build with the repo root as the build context so the workspace manifests are reachable:

```yaml
services:
  manifesto-server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    ports:
      - "3001:3001"
    volumes:
      - manifesto-data:/app/data
    environment:
      CORS_ORIGINS: https://notes.example.com
volumes:
  manifesto-data:
```

```bash
docker compose up --build
```

Data persists across container restarts via the volume mount.

## Environment Variables

See `packages/server/.env.example` for the full list and defaults.

| Variable           | Default                    | Description                              |
|--------------------|----------------------------|------------------------------------------|
| `PORT`             | `3001`                     | Server port                              |
| `STORAGE_DRIVER`   | `sqlite`                   | Storage driver. Currently `sqlite` only. |
| `AUTH_PROVIDER`    | `local`                    | Auth provider. Currently `local` only.   |
| `DATA_DIR`         | `./data`                   | Directory for the SQLite database        |
| `MANIFESTO_DB`     | `${DATA_DIR}/manifesto.db` | Override the SQLite path explicitly      |
| `CORS_ORIGINS`     | `http://localhost:5173`    | Comma-separated allowed client origins   |
| `SESSION_TTL_DAYS` | `30`                       | Session inactivity timeout in days       |
| `LOG_LEVEL`        | `info`                     | One of debug / info / warn / error       |
| `ARGON2_MEMORY_KIB` | `19456`                   | argon2id memory cost (local auth only)   |
| `ARGON2_TIME_COST`  | `2`                       | argon2id time cost (local auth only)     |
| `ARGON2_PARALLELISM` | `1`                      | argon2id parallelism (local auth only)   |

Both `STORAGE_DRIVER` and `AUTH_PROVIDER` are validated at boot. An unknown value fails fast with a clear error.

## Reverse Proxy

For production use behind a reverse proxy (nginx, Caddy, Traefik):

- Proxy all requests to the Manifesto server port
- Proxy WebSocket connections at `/api/ws` (application events) and `/api/yjs/notes/*` (collaborative editing)
- Set appropriate headers (`X-Forwarded-For`, `X-Forwarded-Proto`)
- Enable HTTPS via the reverse proxy
