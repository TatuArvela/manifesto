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

- **SQLite** (`better-sqlite3`, `STORAGE_DRIVER=sqlite`, the default): single file, zero config, ideal for self-hosted single-server deployments.
- **Postgres** (`pg`, `STORAGE_DRIVER=postgres`): managed database, suitable for scale-out and team deployments.

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

- **SQLite**: zero-configuration, a single file you can back up by copying. Fast and ideal for one-server deployments. Pure synchronous writes (better-sqlite3) keep latencies tiny on a notes workload.
- **Postgres**: required for any deployment that wants to scale beyond one app server, share state with other services, or use managed-database backups. The schema mirrors SQLite's; `yjs_state` lives in `BYTEA`.

#### Schema migrations

Each driver declares an ordered list of migrations, and a `schema_migrations`
table in the database records which have run. On boot the driver applies the
ones that are missing, each in its own transaction, and writes its ledger row
in the same transaction, so a step that fails leaves behind neither half of a
schema change nor a claim to have made it.

Both drivers ship the same migration ids, in the same order; a test fails if
they diverge. The SQL differs where the dialects do (SQLite has no boolean
type and no `BYTEA`; Postgres has no `COLLATE NOCASE`), but what a database has
been through is described the same way either side.

A migration id is a promise: once a release has shipped it, it is never
renamed and never removed, because a deployed database remembers having run it.
A driver that finds an applied migration it no longer declares refuses to start
rather than stacking later steps on a schema it cannot describe.

### Authentication providers

Authentication is abstracted as an `AuthProvider`. The provider:

- Implements `authenticate(token)`, which turns a bearer token into an identity (used by HTTP middleware and both WebSocket handshakes).
- Owns its own router, mounted under `/api/auth`. The local provider mounts `/register`, `/login`, `/logout`. The OIDC provider mounts `/login` (302 to the IdP), `/callback`, and `/logout`.

Two implementations ship today:

- **`local`** (default): username + argon2-hashed password, sessions stored server-side. Mounts `/register`, `/login`, `/logout`.
- **`oidc`**: OAuth 2.0 Authorization Code Flow with PKCE against any OpenID Connect IdP (Authentik, Keycloak, Google, Auth0, Okta, etc.). Mounts `/login` (redirect to IdP), `/callback` (code exchange + JIT user provisioning + session mint), `/logout`. The IdP is contacted only at login time; once a session is minted, `authenticate(token)` is identical to the local provider: pure session lookup, no IdP round-trip per request.

The server also exposes two provider-agnostic auth endpoints used by the client: `GET /api/auth/methods` (public, returns the active provider name so the client can pick the right login UI) and `GET /api/auth/me` (bearer-protected, returns the current user; used after an OIDC callback when the client only has a token in the URL fragment).

The `users` schema supports both modes: `password_hash` is nullable, and `(provider, external_id)` is the IdP-stable identity. Local and SSO users coexist in the same table; account linking across providers is not supported in v1.

### REST API

Implements the endpoints defined in [API](../api.md). The auth provider owns `/api/auth/*`; the rest of the surface is static.

### Link previews

`GET /api/link-preview` is the one route that makes the server reach out to the internet on a user's behalf, so it is built around not being turned against the server's own network. `src/linkPreview/safeFetch.ts` resolves the hostname, refuses unless every address is publicly routable (`addressPolicy.ts`), and then connects to that checked address through a pinned `lookup` rather than letting the HTTP client resolve the name a second time, which a hostname with a short TTL could answer differently. Redirects go back through the same check, and the body limit applies after decompression. `parseHtml.ts` reads the metadata with bounded regular expressions, and `fetchPreview.ts` identifies images by their leading bytes. Uses Node's own `http`, `https`, `dns` and `zlib`, with no dependency. See [Link Previews](../features/link-previews.md) for the rules and `LINK_PREVIEWS` to turn it off.

### WebSockets

- `/api/ws`: application JSON socket for `note:*` and `presence:*` events. Authenticates via the active auth provider. Token is passed in the `Sec-WebSocket-Protocol` header.
- `/api/yjs`: Hocuspocus-backed Yjs collaboration channel, multiplexing every note over one socket by document name. The `onAuthenticate` hook resolves the token via the active auth provider and then verifies note ownership against the joined document name via the storage driver. Persistence is delegated to `storage.yjs`, so Yjs state lives in whichever store is selected.

### Multi-User

Each user has their own notes, isolated by user ID. Tags are per-user (each user has their own tag namespace). Collaborative editing is per-note and gated on note ownership.
