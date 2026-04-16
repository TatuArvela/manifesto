# Server Deployment

## Running Directly

```bash
cd packages/server
pnpm install
pnpm start
```

## Docker

```yaml
services:
  manifesto-server:
    build: ./server
    ports:
      - "3001:3001"
    volumes:
      - manifesto-data:/app/data
volumes:
  manifesto-data:
```

```bash
docker compose up
```

Data persists across container restarts via the volume mount.

## Environment Variables

| Variable          | Default              | Description                          |
|-------------------|----------------------|--------------------------------------|
| `PORT`            | `3001`               | Server port                          |
| `DATA_DIR`        | `./data`             | Directory for SQLite database        |

## Reverse Proxy

For production use behind a reverse proxy (nginx, Caddy, Traefik):

- Proxy all requests to the Manifesto server port
- Proxy WebSocket connections for collaborative editing (`/api/ws`) — when implemented
- Set appropriate headers (`X-Forwarded-For`, `X-Forwarded-Proto`)
- Enable HTTPS via the reverse proxy
