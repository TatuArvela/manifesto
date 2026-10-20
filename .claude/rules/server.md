---
paths:
  - "packages/server/src/**"
---

# Server Architecture

The server has two pluggable layers. Env vars select both when the server starts
(`STORAGE_DRIVER`, `AUTH_PROVIDER`).

## Storage

- **`src/storage/`**: the `StorageDriver` interface is in `types.ts`. The interface of each
  repository is in `repos/`, and `types.ts` exports them again. Thus, import them from `types.ts`.
  A driver has the `users`, `sessions`, `notes`, `shares`, `yjs` and `maintenance` repos.
- There are two drivers:
  - `src/storage/sqlite/`: synchronous `better-sqlite3`, inside methods with async types.
  - `src/storage/postgres/`: a `pg` Pool, fully async.
- The two schemas are the same on purpose. SQLite uses `INTEGER` booleans and `BLOB`s. Postgres uses
  native `BOOLEAN` and `BYTEA`. But the typed `Note`, `User` and other shapes that callers get are
  the same.
- The tests of the Postgres driver run against `pg-mem`. Thus, CI does not need a real Postgres.
- The construction of the storage is async (`await createStorage(cfg)`), because the Postgres
  migrations need a query round-trip.

## Authentication

- **`src/auth/`**: the `AuthProvider` interface is in `types.ts`. Each provider gives
  `authenticate(token)` for the middleware and the WS handshakes. Each provider owns its own
  `/api/v1/auth/*` router.
- There are two providers. `AUTH_PROVIDER=both` mounts them together (`auth/index.ts`). To find the
  active provider, use `signsInLocally` and `signsInWithOidc` in `config.ts`. Never compare
  `authProvider` to a name.
  - `src/auth/local/`: username and argon2.
  - `src/auth/oidc/`: OAuth 2.0 Authorization Code with PKCE through `openid-client`. It makes users
    just in time, by `(provider, sub)`.
- Both providers use `src/auth/session.ts` to make sessions and to validate bearer tokens. Thus,
  `authenticate()` is the same for both providers. The IdP is only important at login.
- The `users` schema has a nullable `password_hash`, and the columns `provider` and `external_id`.
  Thus, SSO users and local users are in the same table.
- The endpoints that do not depend on the provider are in `src/auth/sharedRoutes.ts`. They mount
  together with the active provider: `GET /api/v1/auth/me` (bearer → current user) and the related
  routes under `/api/v1/auth/me/*`.
- `GET /api/v1/capabilities` (`routes/capabilities.ts`) tells what the server offers. This includes
  the sign-in methods.

## Composition

**`src/app.ts` / `src/index.ts`** are the composition root. They make the storage, the auth provider
and the broadcaster. Then they connect the Hono app, the `/api/v1/ws` socket (`ws/appSocket.ts`),
and the Yjs collaboration socket. The Yjs socket is `ws/yjsSocket.ts`, with the generic
`ws/yjsExtension.ts` Hocuspocus extension, which sends its work to `storage.yjs`.

## Attachments

`Note.images` contains references in both modes, not bytes:

- In open mode: `local:<sha256>` (IndexedDB, `storage/localImages.ts`).
- In connected mode: `attachment:<id>`, a reference to the `attachments` table.

In connected mode, the client does these steps:

1. It seals each image, and uploads it to `POST /api/v1/attachments`.
2. It makes the image belong to the note owner (`POST /api/v1/attachments/claim`).

Note writes refuse all references other than those of the owner (`claimImages` in
`attachments/store.ts`; see `encryption.md`). The storage accepts only what `claimImages` returns:
`notes.insert` and `notes.update` require `ClaimedImages` for both lists of references (`imageRefs`,
`previewRefs`). This is a branded type that no other code makes. Thus, a write that does not do the
claim does not compile. A storage test vouches with `storage/contracts/claimed.ts`.

The client draws the images through `StoredImage`. For all data that goes out of the session, it
inlines them again (`inlineImages`). A new place that renders a note image must use `StoredImage`.
A new export path must inline the images.

## MCP

`mcp/` is a stateless MCP server. We wrote it here and did not use the SDK, because the dependencies
of the SDK (for example, express) are larger than four JSON-RPC methods.

- `protocol.ts`: JSON-RPC and the lifecycle.
- `tools.ts`: the catalogue.
- `routes.ts`: HTTP.

A tool makes REST calls through `app.fetch` with the token of the caller. It never uses the storage
directly. Thus, all rules of the routes apply to it. A new tool uses routes. If a tool needs a
function that no route gives, make the route first. The specification is
`docs/specification/features/mcp.md`.

The agent skill that teaches the tools is `skills/manifesto/SKILL.md` at the root of the
repository. `mcp/skill.test.ts` fails until the skill names a new tool (also in its `description`),
and until it stops the name of a removed tool.

An assistant can also sign in with OAuth (`oauth/`):

- The consent page belongs to the client (`/oauth/authorize`, `OAuthConsentPage`). The reason is
  that a session is a bearer token, and the server cannot see it on a browser redirect.
- A grant is an `mcp` row of `api_tokens`, with a refresh token. Thus, the list, the revocation and
  `endUserSessions` include it, and it needs no special code.
- Its expiries count from `nowIso()`, which never goes back. Thus, if a test moves the clock forward,
  all subsequent tests also have that change. Change the timestamps of a row in its place.

## Webhooks

`webhooks/dispatcher.ts` subscribes to the broadcaster. Thus, a webhook gets the same events as the
sockets of its owner, and a new note event needs no webhook code. Deliveries go through `safeFetch`
(POST, no redirects), with the address rule that `WEBHOOKS` selects. Never call `fetch` for them.

## Serving the client

When `CLIENT_DIR` is set (the image sets it), `client/serveClient.ts` serves a built client at the
root. `app.ts` mounts it last, so that all API routes answer first. The client in the image is built
with `VITE_MANIFESTO_SERVER=/`.

## Background work

The jobs in `jobs/` (`trashCleanup.ts`, `sessionCleanup.ts`, `attachmentCleanup.ts`,
`scheduledBackup.ts`, `updateCheck.ts`) run on `startPeriodicJob` of `lib/periodic.ts`. Each runs one
time when the server starts, and then at its interval. Each cleanup uses a repo method
(`storage.maintenance.cleanupTrashedBefore()` and `cleanupTrashedSharesBefore()`,
`storage.sessions.deleteExpired()`). It does not use the database directly. Thus, the cleanups work
with all storage drivers.

## Counting against a key

`lib/expiringCounter.ts` is the one bounded map for both throttles:

- `middleware/rateLimit.ts`: for each address, and for each user.
- `auth/local/loginAttempts.ts`: failed sign-ins for each account name.

A sweep of expired keys keeps the map small only while keys expire faster than a caller makes them.
The caller controls that rate. Thus, the real limit is the hard cap, with its eviction of the oldest
keys first.

Both parts need one invariant: when a window opens, the code *inserts it again*. It never changes a
window in place. All keys share one `windowMs`. Thus, the insertion order is also the expiry order.
The sweep can stop at the first live key, and an eviction always takes the key nearest to expiry. If
you change a stale entry in place, the order becomes incorrect. The sweep then stops at the first
key, and the eviction starts to delete live keys before expired keys.

For IPv6, the key for each address is a /64 (`ipBucketKey`). One subscriber has all of the addresses
in a /64. A key on the /128 gives nothing to throttle. For IPv4, the key is the full address. On a
dual-stack listener, an IPv4 client has the form `::ffff:a.b.c.d`. The code first changes this to the
same key as IPv4. If not, all IPv4 clients on the internet share one bucket.
