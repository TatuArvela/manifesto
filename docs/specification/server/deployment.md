# Server Deployment

## Running Directly

```bash
cd server
npm install
npm start
```

## Docker

```yaml
services:
  manifesto-server:
    build: ./server
    ports:
      - "3000:3000"
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
| `PORT`            | `3000`               | Server port                          |
| `DATA_DIR`        | `./data`             | Directory for SQLite database        |

## Reverse Proxy

For production use behind a reverse proxy (nginx, Caddy, Traefik):

- Proxy all requests to the Manifesto server port
- Proxy WebSocket connections for collaborative editing (`/api/ws`)
- Set appropriate headers (`X-Forwarded-For`, `X-Forwarded-Proto`)
- Enable HTTPS via the reverse proxy
