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

Storage is abstracted as a `StorageDriver`. The currently shipped implementation is **SQLite** (`better-sqlite3`), selected with `STORAGE_DRIVER=sqlite` (the default).

The driver bundles five repositories:

| Repository      | Purpose                                                          |
|-----------------|------------------------------------------------------------------|
| `users`         | User accounts (local password or external IdP)                   |
| `sessions`      | Bearer-token sessions for both local and SSO logins              |
| `notes`         | Note CRUD and per-user search                                    |
| `yjs`           | Persisted Y.Doc state for collaborative editing                  |
| `maintenance`   | Background jobs (e.g. trash cleanup) that need bulk DB access    |

Adding another driver — Postgres is the obvious next candidate — means implementing these five interfaces and registering the driver in `src/storage/index.ts`. No other module needs to change.

#### Why SQLite is the default

- Zero-configuration — a single file, no external database service
- Perfect for self-hosted, single-server deployments
- Fast enough for a notes app
- Easy to back up (copy the file)

For larger deployments or scale-out, swap the driver at boot via `STORAGE_DRIVER`.

### Authentication providers

Authentication is abstracted as an `AuthProvider`. The provider:

- Implements `authenticate(token)` — turns a bearer token into an identity (used by HTTP middleware and both WebSocket handshakes).
- Owns its own router, mounted under `/api/auth`. The local provider mounts `/register`, `/login`, `/logout`. An OIDC provider (planned) would mount `/login` (redirect), `/callback`, `/logout`.

The currently shipped implementation is **local** (`AUTH_PROVIDER=local`, the default): username + argon2-hashed password, sessions stored server-side. Future providers (OIDC, SAML) will plug in alongside without changes to the rest of the server.

The `users` schema is already SSO-ready: `password_hash` is nullable, and `provider` + `external_id` columns identify users provisioned via an external IdP. Local and SSO users coexist in the same table; account linking across providers is not supported.

### REST API

Implements the endpoints defined in [API](../api.md). The auth provider owns `/api/auth/*`; the rest of the surface is static.

### WebSockets

- `/api/ws` — application JSON socket for `note:*` and `presence:*` events. Authenticates via the active auth provider. Token is passed in the `Sec-WebSocket-Protocol` header.
- `/api/yjs/notes/<id>` — Hocuspocus-backed Yjs collaboration channel. Authenticates via the active auth provider, then verifies note ownership via the storage driver. Persistence is delegated to `storage.yjs`, so Yjs state lives in whichever store is selected.

### Multi-User

Each user has their own notes, isolated by user ID. Tags are per-user (each user has their own tag namespace). Collaborative editing is per-note and gated on note ownership.
