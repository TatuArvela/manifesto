# Server

The Manifesto server is a separate, optional application that provides persistent storage, authentication, and multi-user support.

## Tech Stack

| Technology      | Purpose                          |
|-----------------|----------------------------------|
| Node.js         | Runtime                          |
| Hono            | HTTP framework                   |
| TypeScript      | Language (strict mode)           |
| better-sqlite3  | Default SQLite storage driver    |
| Hocuspocus + Yjs | Collaborative editing transport |
| argon2          | Password hashing (local auth)    |

## Architecture

The server is split into two pluggable layers behind narrow interfaces. Both are selected at boot via environment variables; the rest of the codebase only depends on the interfaces, never on a concrete implementation.

### Storage drivers

Storage is abstracted as a `StorageDriver`. Two implementations ship today:

- **SQLite** (`better-sqlite3`, `STORAGE_DRIVER=sqlite`, the default) — single file, zero config, ideal for self-hosted single-server deployments.
- **Postgres** (`pg`, `STORAGE_DRIVER=postgres`) — managed database, suitable for scale-out and team deployments.

Both drivers implement the same interface; the rest of the server is identical regardless of which one is selected.

The driver bundles five repositories:

| Repository      | Purpose                                                          |
|-----------------|------------------------------------------------------------------|
| `users`         | User accounts (local password or external IdP)                   |
| `sessions`      | Bearer-token sessions for both local and SSO logins              |
| `notes`         | Note CRUD and per-user search                                    |
| `yjs`           | Persisted Y.Doc state for collaborative editing                  |
| `maintenance`   | Background jobs (e.g. trash cleanup) that need bulk DB access    |

Adding another driver means implementing these five interfaces and registering the driver in `src/storage/index.ts`. No other module needs to change.

#### Driver tradeoffs

- **SQLite** — zero-configuration, a single file you can back up by copying. Fast and ideal for one-server deployments. Pure synchronous writes (better-sqlite3) keep latencies tiny on a notes workload.
- **Postgres** — required for any deployment that wants to scale beyond one app server, share state with other services, or use managed-database backups. The schema mirrors SQLite's; `yjs_state` lives in `BYTEA`.

### Authentication providers

Authentication is abstracted as an `AuthProvider`. The provider:

- Implements `authenticate(token)` — turns a bearer token into an identity (used by HTTP middleware and both WebSocket handshakes).
- Owns its own router, mounted under `/api/auth`. The local provider mounts `/register`, `/login`, `/logout`. An OIDC provider (planned) would mount `/login` (redirect), `/callback`, `/logout`.

Two implementations ship today:

- **`local`** (default) — username + argon2-hashed password, sessions stored server-side. Mounts `/register`, `/login`, `/logout`.
- **`oidc`** — OAuth 2.0 Authorization Code Flow with PKCE against any OpenID Connect IdP (Authentik, Keycloak, Google, Auth0, Okta, etc.). Mounts `/login` (redirect to IdP), `/callback` (code exchange + JIT user provisioning + session mint), `/logout`. The IdP is contacted only at login time; once a session is minted, `authenticate(token)` is identical to the local provider — pure session lookup, no IdP round-trip per request.

The `users` schema supports both modes: `password_hash` is nullable, and `(provider, external_id)` is the IdP-stable identity. Local and SSO users coexist in the same table; account linking across providers is not supported in v1.

### REST API

Implements the endpoints defined in [API](../api.md). The auth provider owns `/api/auth/*`; the rest of the surface is static.

### WebSockets

- `/api/ws` — application JSON socket for `note:*` and `presence:*` events. Authenticates via the active auth provider. Token is passed in the `Sec-WebSocket-Protocol` header.
- `/api/yjs/notes/<id>` — Hocuspocus-backed Yjs collaboration channel. Authenticates via the active auth provider, then verifies note ownership via the storage driver. Persistence is delegated to `storage.yjs`, so Yjs state lives in whichever store is selected.

### Multi-User

Each user has their own notes, isolated by user ID. Tags are per-user (each user has their own tag namespace). Collaborative editing is per-note and gated on note ownership.
