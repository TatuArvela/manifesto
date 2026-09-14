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

The driver bundles six repositories:

| Repository      | Purpose                                                          |
|-----------------|------------------------------------------------------------------|
| `users`         | User accounts (local password or external IdP), admin rights and email addresses |
| `sessions`      | Bearer-token sessions for both local and SSO logins              |
| `notes`         | Note CRUD and search, over the notes a user owns and those shared with them |
| `shares`        | Invitations and shares: who a note is shared with, and on what terms |
| `yjs`           | Persisted Y.Doc state for collaborative editing                  |
| `maintenance`   | Background jobs (e.g. trash cleanup) that need bulk DB access    |

Adding another driver means implementing these six interfaces and registering the driver in `src/storage/index.ts`. No other module needs to change.

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
- Owns its own router, mounted under `/api/auth`. The local provider mounts `/register`, `/login`, `/logout`, `/password`. The OIDC provider mounts `/login` (302 to the IdP), `/callback`, and `/logout`. App-level services a route needs, such as session revocation, are handed to `router()` when it is mounted rather than to the provider when it is built.

Two implementations ship today:

- **`local`** (default): username + argon2-hashed password, sessions stored server-side. Mounts `/register`, `/login`, `/logout`, `/password`.
- **`oidc`**: OAuth 2.0 Authorization Code Flow with PKCE against any OpenID Connect IdP (Authentik, Keycloak, Google, Auth0, Okta, etc.). Mounts `/login` (redirect to IdP), `/callback` (code exchange + JIT user provisioning + session mint), `/logout`. The IdP is contacted only at login time; once a session is minted, `authenticate(token)` is identical to the local provider: pure session lookup, no IdP round-trip per request.

The server also exposes two provider-agnostic auth endpoints used by the client: `GET /api/auth/methods` (public, returns the active provider name so the client can pick the right login UI) and `GET /api/auth/me` (bearer-protected, returns the current user; used after an OIDC callback when the client only has a token in the URL fragment).

The `users` schema supports both modes: `password_hash` is nullable, and `(provider, external_id)` is the IdP-stable identity. Local and SSO users coexist in the same table; account linking across providers is not supported in v1.

### REST API

Implements the endpoints defined in [API](../api.md). The auth provider owns `/api/auth/*`; the rest of the surface is static.

### Administration

`/api/admin` (`src/routes/admin.ts`) lets admins list, create, reset, promote and delete accounts; see [Account Administration](../features/accounts.md). It is provider-agnostic, except that creating accounts and resetting passwords exist only under `AUTH_PROVIDER=local`.

The rules that must hold whatever calls them live in the `users` repository, so both drivers enforce them and a shared contract test (`src/storage/adminContract.ts`) runs against each:

- `create` makes an account admin when asked to, or otherwise exactly when it is the first, decided inside the `INSERT`. Under single sign-on the first sign-in is how a server gets its admin.
- `setAdmin` and `delete` refuse to remove the last admin. SQLite runs the count and the write in an immediate transaction; Postgres locks every admin row (`FOR UPDATE`, in id order) before counting, so two admins demoting each other at once cannot both succeed.

Under local sign-in, `ensureInitialAdmin` (`src/auth/initialAdmin.ts`) runs in `src/index.ts` before the server listens. When no admin has a password of their own it creates `admin` with a temporary password, or gives the still-unclaimed one a fresh password, and prints it regardless of `LOG_LEVEL`. See [The initial admin](../features/accounts.md#the-initial-admin).

Ending a user's sessions (a reset, a deletion, a password change) goes through `endUserSessions` in `src/auth/session.ts`, which deletes the rows and announces the revocation on `src/auth/revocations.ts`. Both socket layers subscribe and close the sockets those sessions opened, because a socket is authenticated only once, when it connects.

### Sharing between accounts

A shared note has one row in `notes`, the owner's, holding the fields everyone shares and the owner's
own color, pin and the rest. Each recipient has a row in `note_shares` holding their role, when they
accepted (`null` while it is an invitation), and their own copy of the personal fields. See
[Sharing with People](../features/sharing-with-people.md) for the rules.

- **Reading.** `notes.listByUser` and `notes.search` read the user's own notes and their accepted
  shares as two index-friendly queries, each over-fetched by one, and merge them by `(updatedAt, id)`,
  so paging sees one ordering. A recipient's copy is the note row with their share laid over it, and
  every note with members carries `sharing`. The mapping lives once, in `storage/shareMapping.ts`, for
  both drivers.
- **Writing.** `notes.update` sends the owner's changes to the note. A recipient's are split: shared
  fields to the note (editors only), personal ones to their share. Both happen in one transaction that
  re-reads their role (SQLite: an immediate transaction; Postgres: the share row `FOR UPDATE`), and
  both stamp the note's `updated_at`, so one `If-Match` token serves every participant. A field the role
  does not allow throws `NoteAccessError`, which the route turns into `403`, and nothing is written.
- **Fan-out.** `src/sharing/noteEvents.ts` sends each participant their own copy after a change, since a
  shared note looks different to each of them, and tells people who lost it (removed, or the note
  trashed or deleted) that it is gone.
- **Sockets.** `src/sharing/accessChanges.ts` announces lost access the way `auth/revocations.ts`
  announces ended sessions. `/api/yjs` closes the affected sockets; `/api/ws` stops showing the person
  on the note and stops telling them who else is.
- **Contract.** `src/storage/sharingContract.ts` runs the same rules against both drivers: an
  invitation grants nothing, personal fields stay apart, viewers cannot write the note, the owner's
  trash hides a note from recipients while a recipient's is their own, an expired recipient trash
  removes only their share, cascades take shares along.

`USER_LOOKUP` decides what `GET /api/users` answers: matches as the owner types (`search`), or only an
exact username or address, never showing the address (`exact`).

### Link previews

`GET /api/link-preview` is the one route that makes the server reach out to the internet on a user's behalf, so it is built around not being turned against the server's own network. `src/linkPreview/safeFetch.ts` resolves the hostname, refuses unless every address is publicly routable (`addressPolicy.ts`), and then connects to that checked address through a pinned `lookup` rather than letting the HTTP client resolve the name a second time, which a hostname with a short TTL could answer differently. Redirects go back through the same check, and the body limit applies after decompression. `parseHtml.ts` reads the metadata with bounded regular expressions, and `fetchPreview.ts` identifies images by their leading bytes. Uses Node's own `http`, `https`, `dns` and `zlib`, with no dependency. See [Link Previews](../features/link-previews.md) for the rules and `LINK_PREVIEWS` to turn it off.

### WebSockets

- `/api/ws`: application JSON socket for `note:*`, `invitation:*` and `presence:*` events. Authenticates via the active auth provider. Token is passed in the `Sec-WebSocket-Protocol` header. A revoked session's connections are closed with `4401`. A `presence:update` is checked against the note's audience (its owner and accepted recipients) and relayed to that audience only.
- `/api/yjs`: Hocuspocus-backed Yjs collaboration channel, multiplexing every note over one socket by document name. The `onAuthenticate` hook resolves the token via the active auth provider and then checks, against the joined document name, that the user may edit the note: its owner, or an accepted recipient who can edit. Persistence is delegated to `storage.yjs`, keyed by the note's owner, so Yjs state lives in whichever store is selected. A revoked session's whole socket is closed, and its reconnect fails authentication; so is the socket of someone who loses the right to edit a note (`4403`).

### Multi-User

Each user has their own notes, isolated by user ID, and sees another user's note only once it is shared with them and they accept. Tags are per-user (each user has their own tag namespace), including on shared notes. Collaborative editing is per-note and gated on the right to edit it.
