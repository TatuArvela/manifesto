---
paths:
  - "packages/server/src/**"
---

# Server Architecture

Two pluggable layers, both selected at boot via env vars (`STORAGE_DRIVER`, `AUTH_PROVIDER`):

- **`src/storage/`**: `StorageDriver` interface in `types.ts`, each repository's interface in `repos/` (re-exported from `types.ts`, so import from there). Bundles `users`, `sessions`, `notes`, `shares`, `yjs`, `maintenance` repos. Two drivers: `src/storage/sqlite/` (sync `better-sqlite3` wrapped in async-typed methods) and `src/storage/postgres/` (`pg` Pool, true-async). Schema parity is intentional. SQLite uses `INTEGER` booleans and `BLOB`s, Postgres uses native `BOOLEAN` and `BYTEA`, but the typed `Note`/`User`/etc. shapes returned to callers are identical. Tests for the Postgres driver run against `pg-mem`, so CI doesn't need a real Postgres. Storage construction is async (`await createStorage(cfg)`) since Postgres migrations require a query round-trip.
- **`src/auth/`**: `AuthProvider` interface in `types.ts`. Each provider exposes `authenticate(token)` for middleware/WS handshakes and owns its own `/api/auth/*` router. Two providers ship, and `AUTH_PROVIDER=both` mounts them side by side (`auth/index.ts`; ask
  `signsInLocally` / `signsInWithOidc` in `config.ts`, never compare `authProvider` to a name):
  `src/auth/local/` (username + argon2) and `src/auth/oidc/` (OAuth 2.0 Authorization Code + PKCE via `openid-client`, with JIT user provisioning by `(provider, sub)`). Both share `src/auth/session.ts` for session mint and bearer-token validation, so `authenticate()` is identical across providers, and the IdP only matters at login time. The `users` schema has nullable `password_hash` plus `provider` and `external_id` columns so SSO and local users coexist in the same table. The provider-agnostic endpoints live in `src/auth/sharedRoutes.ts` and are mounted alongside the active provider: `GET /api/auth/me` (bearer → current user) and its siblings under `/api/auth/me/*`. What the server offers, sign-in methods included, is `GET /api/capabilities` (`routes/capabilities.ts`).
- **`src/app.ts` / `src/index.ts`**: composition root. Constructs storage, auth provider, broadcaster, then wires the Hono app, the `/api/ws` socket (`ws/appSocket.ts`), and the Yjs collaboration socket (`ws/yjsSocket.ts` + the generic `ws/yjsExtension.ts` Hocuspocus extension that delegates to `storage.yjs`).
- **Attachments**: `Note.images` holds references in both modes: `local:<sha256>` in open mode (IndexedDB,
  `storage/localImages.ts`) and in connected mode `attachment:<id>` references to the
  `attachments` table, not bytes: the client uploads each to `POST /api/attachments` first, and note
  writes refuse anything but a reference (`claimImages` in `attachments/store.ts` makes each the note
  owner's, content-addressed per owner). Storage takes only what it returns: `notes.insert` and
  `notes.update` want `ClaimedImages` / `ClaimedPreviews`, branded types nothing else makes, so a
  write that skips the claim does not compile. A storage test vouches with `storage/contracts/claimed.ts`. The client draws them through `StoredImage` and inlines them again for anything that leaves the session (`inlineImages`). A new
  place that renders a note image must use `StoredImage`, and a new export path must inline.
- **MCP**: `mcp/` is a stateless MCP server written here rather than taken from the SDK, whose
  dependencies (express among them) outweigh four JSON-RPC methods: `protocol.ts` (JSON-RPC and the
  lifecycle), `tools.ts` (the catalogue), `routes.ts` (HTTP). A tool is REST calls through
  `app.fetch` with the caller's token and never touches storage, so every rule of the routes holds for
  it. A new tool composes routes; one that needs what no route offers needs the route first. Spec:
  `docs/specification/features/mcp.md`. The agent skill that teaches the tools is
  `skills/manifesto/SKILL.md` at the repo root, and `mcp/skill.test.ts` fails until it names a new
  tool (in its `description` too) and stops naming a removed one.
  An assistant can also sign in by OAuth (`oauth/`): the consent page is the client's
  (`/oauth/authorize`, `OAuthConsentPage`), since a session is a bearer token the server cannot see
  on a browser redirect, and a grant is an `mcp` row of `api_tokens` with a refresh token beside it,
  so listing, revoking and `endUserSessions` cover it with no code of their own. Its expiries are
  counted from `nowIso()`, which never goes back, so a test that jumps the clock forward carries the
  jump into every later test; move a row's timestamps instead.
- **Webhooks**: `webhooks/dispatcher.ts` subscribes to the broadcaster, so a webhook hears what its
  owner's sockets hear and a new note event needs no webhook code. Deliveries go through `safeFetch`
  (POST, no redirects) with the address rule `WEBHOOKS` picks; never call `fetch` for them.
- **Serving the client**: with `CLIENT_DIR` set (it is, in the image) `client/serveClient.ts` serves
  a built client at the root, mounted last in `app.ts` so every API route answers first; the image's
  client is built with `VITE_MANIFESTO_SERVER=/`.
- **Background work**: the jobs in `jobs/` (`trashCleanup.ts`, `sessionCleanup.ts`, `attachmentCleanup.ts`, `scheduledBackup.ts`, `updateCheck.ts`) run on `lib/periodic.ts`'s `startPeriodicJob`, once at startup, then on their interval. Each cleanup goes through a repo method (`storage.maintenance.cleanupTrashedBefore()` and `cleanupTrashedSharesBefore()`, `storage.sessions.deleteExpired()`) rather than touching the DB directly, so both work for any storage driver.
- **Counting against a key**: `lib/expiringCounter.ts` is the one bounded map behind both throttles,
  `middleware/rateLimit.ts` (per address, per user) and `auth/local/loginAttempts.ts` (failed
  sign-ins per account name). Sweeping expired keys bounds the map only while they expire faster
  than a caller creates them, and the caller sets that rate, so the hard cap and its oldest-first
  eviction are the real bound. The invariant both halves rest on is that a window is *re-inserted*
  when it opens and never mutated in place: every key shares one `windowMs`, so insertion order is
  then expiry order, the sweep can stop at the first live key, and an eviction always takes the key
  closest to expiring anyway. Mutate a stale entry in place and the order drifts, the sweep breaks
  at the first key it meets, and eviction starts dropping live keys ahead of expired ones.
  The per-address key is a /64 for IPv6 (`ipBucketKey`), because one subscriber holds every address
  inside one and keying the /128 leaves nothing to throttle. IPv4 is keyed whole, and the
  `::ffff:a.b.c.d` form an IPv4 client takes on a dual-stack listener is unwrapped to that same key
  first, or every IPv4 client on the internet shares one bucket.
