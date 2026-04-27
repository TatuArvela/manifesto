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
| `STORAGE_DRIVER`   | `sqlite`                   | Storage driver: `sqlite` or `postgres`.  |
| `AUTH_PROVIDER`    | `local`                    | Auth provider: `local` or `oidc`.        |
| `DATA_DIR`         | `./data`                   | Directory for the SQLite database        |
| `MANIFESTO_DB`     | `${DATA_DIR}/manifesto.db` | Override the SQLite path explicitly      |
| `DATABASE_URL`     | _(required for postgres)_  | Postgres connection string               |
| `CORS_ORIGINS`     | `http://localhost:5173`    | Comma-separated allowed client origins   |
| `SESSION_TTL_DAYS` | `30`                       | Session inactivity timeout in days       |
| `LOG_LEVEL`        | `info`                     | One of debug / info / warn / error       |
| `ARGON2_MEMORY_KIB` | `19456`                   | argon2id memory cost (local auth only)   |
| `ARGON2_TIME_COST`  | `2`                       | argon2id time cost (local auth only)     |
| `ARGON2_PARALLELISM` | `1`                      | argon2id parallelism (local auth only)   |
| `REGISTRATION_ENABLED` | `true`                  | Allow public POST `/api/auth/register`. Set `false` for managed-mode deployments where accounts are provisioned out-of-band. |
| `TRUST_PROXY`      | `false`                    | Honor `X-Forwarded-For` for IP-aware rate limiting. Set `true` only behind a trusted reverse proxy. |

Both `STORAGE_DRIVER` and `AUTH_PROVIDER` are validated at boot. An unknown value fails fast with a clear error.

### OIDC variables (when `AUTH_PROVIDER=oidc`)

All of these are required and validated at boot. The server only reads them when the OIDC provider is selected.

| Variable                    | Description                                                                 |
|-----------------------------|-----------------------------------------------------------------------------|
| `OIDC_ISSUER`               | Issuer URL (used for OIDC discovery — e.g. `https://idp.example.com`)       |
| `OIDC_CLIENT_ID`            | Client ID registered with the IdP                                           |
| `OIDC_CLIENT_SECRET`        | Client secret registered with the IdP                                       |
| `OIDC_REDIRECT_URI`         | Server callback URL — must end in `/api/auth/callback`                      |
| `OIDC_POST_LOGIN_REDIRECT`  | Client-side URL to redirect to after successful login (token in fragment)   |
| `OIDC_SCOPES`               | Comma-separated scopes (default `openid,profile,email`)                     |

The login flow:

1. The client fetches `GET /api/auth/methods` and renders a "Continue with single sign-on" button when the response is `{ provider: "oidc" }`.
2. The user clicks the button, navigating to `<server>/api/auth/login`. The server stores PKCE state server-side and redirects to the IdP authorization endpoint.
3. After the user consents, the IdP redirects to `OIDC_REDIRECT_URI` with `code` and `state`.
4. The server verifies state, exchanges the code (PKCE), reads ID-token claims, just-in-time provisions a user (keyed by `(provider, sub)`), and mints a Manifesto session token.
5. The server redirects to `OIDC_POST_LOGIN_REDIRECT#token=<sessionToken>`.
6. The client picks up the fragment on first paint, calls `GET /api/auth/me` with the bearer token to fetch the user record, populates its auth signals, and clears the fragment from the address bar.

The session token is then sent as `Authorization: Bearer <token>` against the rest of the API, identical to the local provider. Logout (`POST /api/auth/logout`) invalidates the local session; it does not perform IdP-side logout (RP-initiated logout is not implemented in v1).

Set `OIDC_POST_LOGIN_REDIRECT` to the deployed client URL (e.g. `https://notes.example.com/`). The client app handles the `#token=...` fragment automatically — no extra route is needed on the client side.

#### Worked example: Authentik

```text
OIDC_ISSUER=https://auth.example.com/application/o/manifesto/
OIDC_CLIENT_ID=manifesto
OIDC_CLIENT_SECRET=<from Authentik provider page>
OIDC_REDIRECT_URI=https://server.example.com/api/auth/callback
OIDC_POST_LOGIN_REDIRECT=https://notes.example.com/auth-callback
OIDC_SCOPES=openid,profile,email
AUTH_PROVIDER=oidc
```

In Authentik, configure the application's redirect URI to match `OIDC_REDIRECT_URI` exactly. Other IdPs (Keycloak, Google, Okta, Auth0, Authelia) work the same way — only the `OIDC_ISSUER` differs.

## Postgres deployment

For larger or scale-out deployments, set `STORAGE_DRIVER=postgres` and `DATABASE_URL=...`. The schema is created on first boot.

```yaml
services:
  manifesto-db:
    image: postgres:16
    environment:
      POSTGRES_DB: manifesto
      POSTGRES_USER: manifesto
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - manifesto-pg:/var/lib/postgresql/data
  manifesto-server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    depends_on: [manifesto-db]
    environment:
      STORAGE_DRIVER: postgres
      DATABASE_URL: postgres://manifesto:${POSTGRES_PASSWORD}@manifesto-db:5432/manifesto
      CORS_ORIGINS: https://notes.example.com
    ports:
      - "3001:3001"
volumes:
  manifesto-pg:
```

Yjs document state lives in a `BYTEA` column on `notes`. For very high collaborative-editing throughput, consider terminating Hocuspocus persistence in Redis and treating Postgres as the cold store — but for typical note-taking workloads the single-table model is fine.

## Reverse Proxy

For production use behind a reverse proxy (nginx, Caddy, Traefik):

- Proxy all requests to the Manifesto server port
- Proxy WebSocket connections at `/api/ws` (application events) and `/api/yjs/notes/*` (collaborative editing)
- Set appropriate headers (`X-Forwarded-For`, `X-Forwarded-Proto`)
- Enable HTTPS via the reverse proxy
