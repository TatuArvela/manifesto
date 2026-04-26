# API

The API is the contract between the Manifesto client and server. Any server implementing this contract is compatible with the Manifesto client.

## REST API

### Notes

| Method   | Path             | Description          |
|----------|------------------|----------------------|
| `GET`    | `/api/notes`     | List all notes       |
| `GET`    | `/api/notes/:id` | Get a single note    |
| `POST`   | `/api/notes`     | Create a note        |
| `PUT`    | `/api/notes/:id` | Update a note        |
| `DELETE` | `/api/notes/:id` | Permanently delete   |

### Search

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `GET`    | `/api/search?q=`  | Search notes         |

### Authentication

Endpoints under `/api/auth/*` are owned by the configured auth provider. The shape below is what the **local** provider exposes — the server's only built-in provider today. A different provider (e.g. OIDC) will mount a different set of routes under the same prefix.

| Method   | Path                  | Description          |
|----------|-----------------------|----------------------|
| `POST`   | `/api/auth/register`  | Create account       |
| `POST`   | `/api/auth/login`     | Log in               |
| `POST`   | `/api/auth/logout`    | Log out              |

All `/api/notes` and `/api/search` endpoints require authentication. Requests include a session token in the `Authorization: Bearer <token>` header. The token format and the way it is issued depend on the auth provider; clients treat it as opaque.

### Request and Response Format

- Content type: `application/json`
- Note objects follow the schema defined in [Data Model](data-model.md)
- `POST /api/notes` accepts a note without `id`, `createdAt`, or `updatedAt` (server assigns these)
- `PUT /api/notes/:id` accepts a partial note (only the fields being changed), and supports `If-Match: <updatedAt>` for optimistic concurrency. On a stale match the server replies `412 Precondition Failed` with the current note so the client can run a 3-way merge and retry.
- List endpoints return `{ "notes": Note[] }`
- Single note endpoints return `{ "note": Note }`
- Errors return `{ "error": string }`

## WebSocket APIs

The server exposes two WebSocket endpoints. Both authenticate by passing the bearer token through `Sec-WebSocket-Protocol` alongside the `manifesto-session` subprotocol.

### Application socket — `/api/ws`

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

### Collaboration socket — `/api/yjs/notes/<id>`

A Hocuspocus-backed Yjs channel for per-note collaborative editing. The server verifies that the authenticated user owns the note before upgrading the connection. Persisted Y.Doc state lives in the active storage driver (today: SQLite).
