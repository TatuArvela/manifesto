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

`packages/shared/src/api.ts` declares the wire types. Each area has one module in `src/api/`, and
`api.ts` exports all of them again. `docs/specification/api.md` is the source of truth.

## The OpenAPI document

`GET /api/v1/openapi.json` comes from `src/openapi.ts`. Its request bodies are the validation
schemas in `validation/`, with one file for each area: `accountSchemas.ts`, `noteSchemas.ts`,
`sharingSchemas.ts` and `accessSchemas.ts`. These use the parts in `fields.ts`. Add each new route
to `OPERATIONS` (through the list of its area in `src/openapi/`). If you do not,
`openapi.test.ts` fails.

Clients can generate code from the document. `node dist/cli.js openapi` prints it without a
database.

- `openapi.ts` describes each response of the public surface with `exact`. Each property is
  required, unless it has the name optional.
- `openapi.conformance.test.ts` compares the real responses of the server with the document. When a
  public operation gets a response shape, add the call to that test.
- `exact` keeps the schema open, because the policy permits additions. Thus, the `undeclared` of the
  test finds a field that the document does not have. The schema does not.
- When a request schema refers to itself, zod gives `$defs`. `embeddable` moves these into the
  components, so that no reference is broken.

## Protection

`OPERATIONS` is also the protection of each route, and nothing else is. Each entry declares:

- `auth`: `none`, `any`, `session`, `admin` or `mcp`.
- `limits`: its rate limits (`BUCKETS` in `middleware/protect.ts`). This is required. Use `[]` for
  no limit.

One middleware on `/api/v1/*` (`createProtection`) applies them from the route that Hono matched.
Routers do not mount their own auth or rate limit. The middleware refuses a matched route that no
entry declares. `/api/v1/ws` checks its caller in the handshake (`SELF_AUTHENTICATED`).
`middleware/protect.test.ts` compares the list with the running app. It also makes sure that the
routes that secure an account need a session.

## Features

One registry, `FEATURES` in `features.ts`, lists what a host can switch off. Each entry has its env
var, its default and its requirements. `SERVER_FEATURES` in shared gives the names.

- An operation of a feature declares it as `feature` in `OPERATIONS`. `createProtection` sends the
  usual 404 of the app before all other checks. Thus, a feature that is off looks absent. Never add
  `if (!cfg.x) throw 404` to a route.
- Code that no route controls (the kind of a token, a socket, a job, OIDC team sync) calls
  `isFeatureOn`. That function also applies the requirements.
- The ways to leave a feature (to remove a share, a passkey, two-factor, a token) have no `feature`.
  They always stay open.
- `/api/v1/capabilities` reports the registry. The client reads it through `serverFeature()`
  (`state/serverFeatures.ts`).
- A new feature needs an entry in both lists, its tags, and a line in "Turning features off" in the
  deployment document. `features.test.ts` checks this.

## Compatibility

From 1.0.0, the compatibility policy in `api.md` applies to the public surface. The public surface
is all that a token can reach, the routes without credentials in `isPublicSurface`, the webhook
payloads and the MCP tools.

- Additions are permitted at all times.
- A removal or a change of meaning needs a deprecation first (`deprecated` on the operation). The
  deprecation must stay for a minimum of two minor releases.
- Before 1.0.0, all contracts can change, with a release note.
- The routes that only a session can use belong to the web client. They can change with it at all
  times.

## Endpoints

- REST: `/api/v1/notes` (with `/api/v1/notes/:id/shares`), `/api/v1/search`,
  `/api/v1/invitations`, `/api/v1/users`, `/api/v1/auth/*`. The active auth provider owns the auth
  routes.
- WebSockets:
  - `/api/v1/ws`: application events and presence. It authenticates through
    `Sec-WebSocket-Protocol`.
  - `/api/v1/yjs`: Hocuspocus collaboration. One socket serves all notes, and the note id is the
    document name. It authenticates in the Hocuspocus `Auth` message. In `onAuthenticate`, it
    checks the right to edit the joined document (the owner or an `edit` recipient).
- All timestamps are ISO 8601 UTC strings.
- For the note schema, see `docs/specification/data-model.md`.
