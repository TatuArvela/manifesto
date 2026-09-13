# API

The API is the contract between the Manifesto client and server. Any server implementing this contract is compatible with the Manifesto client.

## REST API

### Notes

| Method   | Path             | Description          |
|----------|------------------|----------------------|
| `GET`    | `/api/notes`     | List notes, one page at a time |
| `GET`    | `/api/notes/:id` | Get a single note    |
| `POST`   | `/api/notes`     | Create a note        |
| `PUT`    | `/api/notes/:id` | Update a note        |
| `DELETE` | `/api/notes/:id` | Permanently delete   |

### Search

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/search?q=`  | Search notes, one page at a time |

### Link previews

| Method   | Path                     | Description          |
|----------|--------------------------|----------------------|
| `GET`    | `/api/link-preview?url=` | Read a page's title, description, image and favicon |

Requires authentication. `url` must be `http` or `https` and at most 2048
characters, or the server replies `422`. The response is
`{ "preview": LinkPreview | null }`: `null` when the page could not be fetched
(it was down, not HTML, too slow, or on an address that is not public), which is
an ordinary answer rather than an error. `image` and `favicon` are the source
images as fetched, inlined as `data:` URLs of up to 1.5 MB, and are **not** the
form a note stores: the client shrinks them to the 64 KB a note accepts. A
server with previews turned off (`LINK_PREVIEWS=off`) replies `404`. Limited to
40 requests a minute per user, on top of the general API limit. What the server
will and will not fetch is in [Link Previews](features/link-previews.md#what-the-server-fetches).

### Authentication

Endpoints under `/api/auth/*` are owned by the configured auth provider. Two providers ship today:

**Local** (`AUTH_PROVIDER=local`):

| Method   | Path                  | Description          |
|----------|-----------------------|----------------------|
| `POST`   | `/api/auth/register`  | Create account       |
| `POST`   | `/api/auth/login`     | Log in               |
| `POST`   | `/api/auth/logout`    | Log out              |

**OIDC** (`AUTH_PROVIDER=oidc`):

| Method   | Path                  | Description                                                              |
|----------|-----------------------|--------------------------------------------------------------------------|
| `GET`    | `/api/auth/login`     | 302 to the IdP's authorization endpoint (Authorization Code Flow + PKCE) |
| `GET`    | `/api/auth/callback`  | IdP redirects here; server exchanges code, mints session, 302 to client  |
| `POST`   | `/api/auth/logout`    | Log out                                                                  |

The login flow is bound to one browser. `GET /api/auth/login` sets a
`manifesto_oidc_flow` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/api/auth`,
`Secure` when the redirect URI is https) holding the `state` it issued, and the
callback rejects any request whose cookie does not match its `state` parameter.
Without that, a callback URL captured from an attacker's own login can be
replayed at a victim to sign them into the attacker's account. The cookie is
cleared as soon as a callback is spent, so it is never a long-lived credential.
Both endpoints are throttled per IP (30 requests / 15 minutes, shared).

**Provider-agnostic** (always available):

| Method   | Path                  | Description                                                              |
|----------|-----------------------|--------------------------------------------------------------------------|
| `GET`    | `/api/auth/methods`   | Public: `{ provider: "local" \| "oidc" }`. Used by the client to pick the login UI. |
| `GET`    | `/api/auth/me`        | Bearer-protected: `{ user: AuthUser }`. Used by the client to fetch the current user from a token (e.g. after consuming an OIDC callback fragment). |

All `/api/notes` and `/api/search` endpoints require authentication. Requests include a session token in the `Authorization: Bearer <token>` header. The token format and the way it is issued depend on the auth provider; clients treat it as opaque.

### Request and Response Format

- Content type: `application/json`
- Note objects follow the schema defined in [Data Model](data-model.md)
- `POST /api/notes` accepts a note without `id`, `createdAt`, or `updatedAt` (server assigns these). `trashedAt` is server-assigned too: it is derived from `trashed`, and a value sent by a client is ignored
- `PUT /api/notes/:id` accepts a partial note (only the fields being changed), and supports `If-Match: <updatedAt>` for optimistic concurrency. On a stale match the server replies `412 Precondition Failed` with the current note so the client can run a 3-way merge and retry. Note: the compare-and-swap is timestamp-based at millisecond precision, so two writes that complete within the same millisecond can both succeed (the second silently overwrites the first). For high-concurrency editing of the same note, use the Yjs collaboration socket instead.
- List endpoints return `{ "notes": Note[], "nextCursor": string | null }`
- Single note endpoints return `{ "note": Note }`
- Errors return `{ "error": string }`

### Paging the list endpoints

`GET /api/notes` and `GET /api/search` return one page and, when there is more,
an opaque `nextCursor` to pass back as `?cursor=`. `?limit=` sets the page size;
it defaults to 200 and is clamped to 500 rather than refused, since a caller
asking for more than a page holds wants as much as it can get and a `400` tells
it nothing it can act on. A cursor the server did not write **is** refused with
`400`: quietly restarting from the top would hand a paging client the first page
over and over.

Notes are ordered by `(updatedAt, id)` descending. The id is part of the key
rather than decoration. Two notes saved in the same millisecond have no order
by timestamp alone, and a page boundary falling between them would repeat one
and drop the other.

The first-party client drains every page on load: it keeps all of a user's notes
in memory, because tag counts, filtering and open-mode search are computed over
the whole list. Paging bounds any single response; it does not change what the
client holds.

### Attachments are not in a listing

A note returned by a list endpoint carries `imageCount` and an **empty**
`images`. The bytes come from `GET /api/notes/:id`, which returns the note
whole.

This is what makes a listing's size a function of how many notes a user has
rather than of how many pictures they have attached, each of which may be up to
1.5 MB, inlined as a `data:` URL in the note itself (see
[Data Model](data-model.md#images)). A client must therefore not read an empty
`images` as "this note has no pictures": compare it with `imageCount`, and fetch
the note before doing anything that needs the bytes: drawing them, exporting
the note, or writing a new list of attachments back.

In open mode nothing is ever separated from its note, so `imageCount` is absent
there and `images` is always complete.

## WebSocket APIs

The server exposes two WebSocket endpoints. They authenticate differently, because the collaboration socket is a Hocuspocus room rather than a plain JSON stream; see each section below.

### Application socket: `/api/ws`

A JSON event stream used for fan-out of REST writes and presence tracking.

| Event              | Direction        | Description                              |
|--------------------|------------------|------------------------------------------|
| `note:created`     | Server → Client  | A new note was created                   |
| `note:updated`     | Server → Client  | A note was changed                       |
| `note:deleted`     | Server → Client  | A note was permanently deleted           |
| `presence:join`    | Server → Client  | A user started viewing/editing a note    |
| `presence:leave`   | Server → Client  | A user stopped viewing/editing a note    |
| `presence:update`  | Client → Server  | The client is viewing/editing a note     |

REST is the authoritative write path; the server fans out `note:*` events from REST handlers. A `note:edit` client→server event is reserved but not currently handled.

The application socket authenticates by passing the bearer token through `Sec-WebSocket-Protocol` alongside the `manifesto-session` subprotocol.

### Collaboration socket: `/api/yjs`

A Hocuspocus-backed Yjs channel for per-note collaborative editing. One endpoint serves every note: Hocuspocus multiplexes documents over a single socket by name, so the note id travels in the protocol as the document name rather than in the path.

Authentication uses the Hocuspocus `Auth` message, not `Sec-WebSocket-Protocol`: clients send the bearer token as the provider's `token` option. The server's `onAuthenticate` hook resolves the token to a user and then verifies that the user owns the note named by that document, rejecting with a permission-denied message before the document is created or joined. Checking the document name rather than a path segment is what makes the check binding: Hocuspocus keys its document map on the name in the frame and never reads the URL.

Persisted Y.Doc state lives in the configured storage driver (SQLite or Postgres).
