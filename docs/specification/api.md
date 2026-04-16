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

| Method   | Path              | Description          |
|----------|-------------------|----------------------|
| `POST`   | `/api/auth/register` | Create account    |
| `POST`   | `/api/auth/login`    | Log in            |
| `POST`   | `/api/auth/logout`   | Log out           |

All `/api/notes` and `/api/search` endpoints require authentication. Requests include a session token in the `Authorization` header.

### Request and Response Format

- Content type: `application/json`
- Note objects follow the schema defined in [Data Model](data-model.md)
- `POST /api/notes` accepts a note without `id`, `createdAt`, or `updatedAt` (server assigns these)
- `PUT /api/notes/:id` accepts a partial note (only the fields being changed)
- List endpoints return `{ "notes": Note[] }`
- Single note endpoints return `{ "note": Note }`
- Errors return `{ "error": string }`

## WebSocket API (Planned)

> **Not yet implemented.** This section describes the planned WebSocket API for [Collaborative Editing](features/collaborative-editing.md).

The client will connect to the server via WebSocket for real-time updates.

### Connection

```
ws(s)://server/api/ws
```

Authenticated via the same session token (sent as a query parameter or in the initial handshake).

### Events

| Event              | Direction        | Description                              |
|--------------------|------------------|------------------------------------------|
| `note:updated`     | Server → Client  | A note was changed by another user       |
| `note:created`     | Server → Client  | A new note was created by another user   |
| `note:deleted`     | Server → Client  | A note was permanently deleted           |
| `presence:join`    | Server → Client  | A user started viewing/editing a note    |
| `presence:leave`   | Server → Client  | A user stopped viewing/editing a note    |
| `note:edit`        | Client → Server  | The client is sending a change to a note |
| `presence:update`  | Client → Server  | The client is viewing/editing a note     |

Event payloads include the note `id` and the relevant data. The `note:edit` event carries a partial note update (same format as `PUT /api/notes/:id`).
