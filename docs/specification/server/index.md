# Server

The Manifesto server is a separate, optional application. It gives persistent storage,
authentication, and support for many users.

## Tech Stack

| Technology      | Purpose                          |
|-----------------|----------------------------------|
| Node.js         | Runtime                          |
| Hono            | HTTP framework                   |
| TypeScript      | Language (strict mode)           |
| better-sqlite3  | Default SQLite storage driver    |
| Hocuspocus + Yjs | Transport for collaborative editing |
| argon2          | Password hashing (local auth)    |

## Architecture

The server has two pluggable layers behind narrow interfaces. Environment variables select both when
the server starts. The other code depends only on the interfaces, never on a concrete
implementation.

### Storage drivers

A `StorageDriver` is the abstraction of the storage. There are two implementations now:

- **SQLite** (`better-sqlite3`, `STORAGE_DRIVER=sqlite`, the default): one file, no configuration.
  It is the best choice for a self-hosted deployment on one server.
- **Postgres** (`pg`, `STORAGE_DRIVER=postgres`): a managed database. It is correct for scale-out
  and for team deployments.

Both drivers implement the same interface. The other parts of the server are the same, whatever
driver you select.

The driver has six repositories:

| Repository      | Purpose                                                          |
|-----------------|------------------------------------------------------------------|
| `users`         | User accounts (local password or external IdP), admin rights and email addresses |
| `sessions`      | Bearer-token sessions for local logins and SSO logins            |
| `notes`         | Note operations and search, over the notes that a user owns and the notes shared with them |
| `shares`        | Invitations and shares: with whom a note is shared, and with which rights |
| `yjs`           | The persisted Y.Doc state for collaborative editing              |
| `maintenance`   | Background jobs (for example, trash cleanup) that need bulk database access |

To add a driver, implement these six interfaces, and register the driver in
`src/storage/index.ts`. No other module must change.

#### Driver tradeoffs

- **SQLite**: no configuration, one file. Make a backup with the `.backup` command of SQLite, not
  with `cp` (the driver runs WAL; see [Backups](deployment.md#backups)). It is fast and is the best
  choice for a deployment on one server. Synchronous writes (better-sqlite3) keep the latencies very
  small for a notes workload.
- **Postgres**: necessary for a deployment with more than one app server, a deployment that shares
  state with other services, or a deployment that uses the backups of a managed database. The schema
  is the same as that of SQLite. `yjs_state` is in `BYTEA`.

#### Schema migrations

Each driver declares an ordered list of migrations. A `schema_migrations` table in the database
records which migrations ran. When the server starts, the driver applies the missing migrations.
Each migration runs in its own transaction. The driver writes its ledger row in the same
transaction. Thus, if a step fails, it leaves no half of a schema change, and no record that it made
the change.

Many instances can start against one Postgres database at the same time (a rolling deploy, two
replicas). Each step runs under a database advisory lock. When the instance has the lock, it checks
the ledger again. Thus, one instance runs the step, and the others wait and then skip it. SQLite has
one writer at a time by design, and one server for each file.

Both drivers have the same migration ids, in the same order. A test fails if they are different. The
SQL is different where the dialects are different (SQLite has no boolean type and no `BYTEA`;
Postgres has no `COLLATE NOCASE`). But both sides describe the history of a database in the same way.

A migration id is a promise. After a release contains it, we never rename it and never remove it,
because a deployed database remembers that it ran. If a driver finds an applied migration that it
does not declare now, it does not start. It does not add later steps on a schema that it cannot
describe.

### Authentication providers

An `AuthProvider` is the abstraction of authentication. The provider:

- Implements `authenticate(token)`, which changes a bearer token into an identity. The HTTP
  middleware and both WebSocket handshakes use it.
- Owns its own router, mounted under `/api/v1/auth`. The local provider mounts `/register`,
  `/login`, `/logout` and `/password`. The OIDC provider mounts `/login` (302 to the IdP),
  `/callback` and `/logout`. The app-level services that a route needs, for example session
  revocation, go to `router()` when it mounts. They do not go to the provider when it is built.

There are two implementations now:

- **`local`** (default): username and argon2-hashed password. The server stores the sessions. It
  mounts `/register`, `/login`, `/logout` and `/password`.
- **`oidc`**: OAuth 2.0 Authorization Code Flow with PKCE, against an OpenID Connect IdP (Authentik,
  Keycloak, Google, Auth0, Okta and others). It mounts `/login` (redirect to the IdP), `/callback`
  (code exchange, user provisioning just in time, and a new session) and `/logout`. The server
  contacts the IdP only at login. After the server makes a session, `authenticate(token)` is the same
  as for the local provider: only a session lookup, with no IdP round trip for each request.

The server also has auth endpoints that do not depend on the provider, for the client:
`GET /api/v1/auth/me` (bearer-protected, returns the current user). The client uses it after an OIDC
callback, when it has only a token in the URL fragment. The public `GET /api/v1/capabilities` tells
how to sign in. The client reads it to select the login UI.

The `users` schema supports both modes: `password_hash` is nullable, and `(provider, external_id)`
is the stable identity from the IdP. Local users and SSO users are in the same table. Version 1 does
not support account links across providers.

### REST API

The server implements the endpoints in [API](../api.md). The auth provider owns `/api/v1/auth/*`.
The other routes are static.

### Administration

`/api/v1/admin` (`src/routes/admin.ts`) lets admins list, create, reset, promote and delete accounts.
See [Account Administration](../features/accounts.md). It does not depend on the provider. The
exceptions are the creation of accounts and the reset of passwords, which exist only with
`AUTH_PROVIDER=local`.

The rules that must apply for all callers are in the `users` repository. Thus, both drivers enforce
them, and a shared contract test (`src/storage/contracts/adminContract.ts`) runs against each driver:

- `create` makes an account admin when the caller asks for it. If not, it makes the account admin
  only when it is the first account. The `INSERT` decides this. With single sign-on, the first
  sign-in gives a server its admin.
- `setAdmin` and `delete` refuse to remove the last admin. SQLite runs the count and the write in an
  immediate transaction. Postgres locks all admin rows (`FOR UPDATE`, in id order) before it counts.
  Thus, if two admins demote each other at the same time, both cannot succeed.

With local sign-in, `ensureInitialAdmin` (`src/auth/initialAdmin.ts`) runs in `src/index.ts` before
the server listens. When no admin has their own password, it creates `admin` with a temporary
password, or gives the unclaimed `admin` a new password. It prints the password, whatever the
`LOG_LEVEL`. See [The initial admin](../features/accounts.md#the-initial-admin).

When the sessions of a user end (a reset, a deletion, a password change), this goes through
`endUserSessions` in `src/auth/session.ts`. It deletes the rows, and announces the revocation on
`src/auth/revocations.ts`. Both socket layers subscribe, and close the sockets of those sessions. The
reason is that a socket authenticates only one time, when it connects.

### Sharing between accounts

A shared note has one row in `notes`, the row of the owner. It contains the fields that all persons
share, and the personal color, pin and other fields of the owner. Each recipient has a row in
`note_shares`. That row contains their role, the time when they accepted (`null` while it is an
invitation), and their own copy of the personal fields. See
[Sharing with People](../features/sharing-with-people.md) for the rules.

- **Reading.** `notes.listByUser` and `notes.search` read the own notes of the user and the accepted
  shares, as two queries that can use indexes. Each query gets one more row than necessary. The
  results merge by `(updatedAt, id)`. Thus, paging sees one order. The copy of a recipient is the note
  row with their share over it. Each note with members has `sharing`. The mapping is in one place,
  `storage/shareMapping.ts`, for both drivers.
- **Writing.** `notes.update` sends the changes of the owner to the note. The changes of a recipient
  are split: shared fields go to the note (only for editors), and personal fields go to their share.
  Both occur in one transaction, which reads their role again (SQLite: an immediate transaction;
  Postgres: the share row `FOR UPDATE`). Both set the `updated_at` of the note. Thus, one `If-Match`
  token serves all participants. A field that the role does not permit throws `NoteAccessError`. The
  route changes it to `403`, and nothing is written.
- **Fan-out.** After a change, `src/sharing/noteEvents.ts` sends each participant their own copy,
  because a shared note looks different to each of them. It tells the persons who lost it (removed,
  or the note was trashed or deleted) that it is gone.
- **Sockets.** `src/sharing/accessChanges.ts` announces lost access, in the same way as
  `auth/revocations.ts` announces ended sessions. `/api/v1/yjs` closes the sockets of the person.
  `/api/v1/ws` stops the presence of the person on the note, and stops telling them who else is
  there.
- **Contract.** `src/storage/contracts/sharingContract.ts` runs the same rules against both drivers:
  - An invitation gives no rights.
  - Personal fields stay separate.
  - Viewers cannot write the note.
  - The trash of the owner hides a note from recipients. The trash of a recipient belongs only to
    that recipient.
  - An expired trash of a recipient removes only their share.
  - Cascades remove the shares too.

`USER_LOOKUP` decides what `GET /api/v1/users` answers. `exact` (the default) answers only an exact
username or address, and never shows the address. `search` answers matches while the owner types.

### Link previews

`GET /api/v1/link-preview` is the only route that makes the server connect to the internet for a
user. Thus, its design prevents its use against the network of the server.

- `src/linkPreview/safeFetch.ts` resolves the hostname. It refuses the request unless each address
  is publicly routable (`addressPolicy.ts`).
- It then connects to that checked address through a pinned `lookup`. It does not let the HTTP
  client resolve the name a second time. A hostname with a short TTL can give a different answer the
  second time.
- Redirects go through the same check again. The body limit applies after decompression.
- `parseHtml.ts` reads the metadata with bounded regular expressions.
- `fetchPreview.ts` identifies images by their first bytes.
- It uses the `http`, `https`, `dns` and `zlib` modules of Node, with no dependency.

See [Link Previews](../features/link-previews.md) for the rules, and `LINK_PREVIEWS` to turn it off.

### WebSockets

- `/api/v1/ws`: the application JSON socket for `note:*`, `invitation:*` and `presence:*` events.
  - It authenticates through the active auth provider. The token goes in the
    `Sec-WebSocket-Protocol` header.
  - The server closes the connections of a revoked session with `4401`.
  - The server checks a `presence:update` against the audience of the note (its owner and the
    accepted recipients), and sends it only to that audience.
- `/api/v1/yjs`: the Yjs collaboration channel, with Hocuspocus. It sends all notes over one socket,
  by document name.
  - The `onAuthenticate` hook resolves the token through the active auth provider. Then it checks,
    against the joined document name, that the user can edit the note: its owner, or an accepted
    recipient who can edit.
  - `storage.yjs` does the persistence, with the owner of the note as the key. Thus, the Yjs state is
    in the selected store.
  - The server closes the full socket of a revoked session, and its reconnect fails authentication.
    It does the same for the socket of a person who loses the right to edit a note (`4403`).

### Multi-User

Each user has their own notes, isolated by user ID. A user sees a note of a different user only
after it is shared with them, and they accept it. Each user has their own tags (their own tag
namespace), also on shared notes. Collaborative editing applies to each note, and needs the right to
edit it.
