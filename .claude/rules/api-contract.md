---
paths:
  - "packages/server/src/routes/**"
  - "packages/server/src/openapi.ts"
  - "packages/server/src/openapi/**"
  - "packages/server/src/middleware/**"
  - "packages/server/src/features.ts"
  - "packages/server/src/validation/**"
  - "packages/shared/src/api.ts"
  - "packages/shared/src/api/**"
  - "packages/client/src/state/serverFeatures.ts"
  - "docs/specification/api.md"
---

# API Contract

`packages/shared/src/api.ts` declares the wire types (one module per area in `src/api/`, all re-exported from
it) and `docs/specification/api.md` is the source of truth.
`GET /api/openapi.json` is generated from `src/openapi.ts`, whose request bodies are the validation
schemas; a new route must be added to `OPERATIONS` there (through its area's list in `src/openapi/`),
or `openapi.test.ts` fails.

The document is meant to be generated from (`node dist/cli.js openapi` prints it with no database). A
response of the public surface is described with `exact` in `openapi.ts`, every property required unless
named optional, and `openapi.conformance.test.ts` checks the server's real answers against it; add the
call there when a public operation gains a response shape. A request schema that refers to itself comes
out of zod with `$defs`, which `embeddable` lifts into the components so no reference dangles.

`OPERATIONS` is also every route's protection, and nothing else is: each declares `auth` (`none`,
`any`, `session`, `admin`, `mcp`) and its rate-limit `limits` (`BUCKETS` in `middleware/protect.ts`,
required, `[]` for none), and one middleware on `/api/*` (`createProtection`) applies them from the
route Hono matched. Routers mount no auth or rate limit of their own, and a matched route nobody
declared is refused. `/api/ws` checks its own caller in the handshake (`SELF_AUTHENTICATED`).
`middleware/protect.test.ts` walks the list against the running app, and pins what secures an account
to a session.

What a host can switch off is one registry, `FEATURES` in `features.ts` (its env var, default and
what it requires; `SERVER_FEATURES` in shared names them). An operation of one says so as `feature`
in `OPERATIONS`, and `createProtection` answers it with the app's own 404 before anything else, so an
off feature looks absent; never add an `if (!cfg.x) throw 404` to a route. What no route decides (a
token's kind, a socket, a job, OIDC team sync) asks `isFeatureOn`, which also applies requirements.
The ways out of a feature (removing a share, a passkey, two-factor, a token) carry no `feature` and
stay open. `/api/capabilities` reports the registry and the client reads it through
`serverFeature()` (`state/serverFeatures.ts`); a new feature is an entry in both lists, its tags,
and a line in the deployment doc's "Turning features off", which `features.test.ts` checks.

The public surface (whatever a token can reach, the credential-free routes in `isPublicSurface`,
webhook payloads, MCP tools) will be under the compatibility policy in `api.md` from 1.0.0: additions
any time, removals and changes of meaning only after a deprecation (`deprecated` on the operation) of at
least two minor releases. Before 1.0.0 every contract may change, with a release note. The session-only
routes are the web client's own and may change with it either way.

- REST: `/api/notes` (with `/api/notes/:id/shares`), `/api/search`, `/api/invitations`, `/api/users`, `/api/auth/*` (auth routes are owned by the active auth provider)
- WebSockets: `/api/ws` (application events, presence) and `/api/yjs` (Hocuspocus collaboration: one socket for every note, the note id is the document name). `/api/ws` authenticates via `Sec-WebSocket-Protocol`; `/api/yjs` authenticates in the Hocuspocus `Auth` message and authorizes the right to edit the joined document (owner or `edit` recipient) in `onAuthenticate`.
- All timestamps are ISO 8601 UTC strings
- Note schema: see `docs/specification/data-model.md`
