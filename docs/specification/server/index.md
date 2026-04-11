# Server

The Manifesto server is a separate, optional application that provides persistent storage, authentication, and multi-user support.

## Tech Stack

| Technology      | Purpose                    |
|-----------------|----------------------------|
| Node.js         | Runtime                    |
| Express or Hono | HTTP framework             |
| better-sqlite3  | SQLite database            |
| TypeScript      | Language (strict mode)     |

### Why SQLite

- Zero-configuration — a single file, no external database service
- Perfect for self-hosted, single-server deployments
- Fast enough for a notes app
- Easy to back up (copy the file)

## Architecture

### REST API

Implements the endpoints defined in [API](../api.md). Handles CRUD for notes, search, and authentication.

### WebSocket

Provides real-time updates for [Collaborative Editing](../features/collaborative-editing.md). Broadcasts note changes and presence events to connected clients.

### Authentication

- User registration and login
- Session-based authentication
- Session tokens sent in the `Authorization` header
- All note endpoints require authentication

### Multi-User

- Each user has their own notes, isolated by user ID
- Tags are per-user (each user has their own tag namespace)
- Collaborative editing allows multiple users to edit the same note in real time

### Database

SQLite with tables for:

- `users` — User accounts
- `notes` — Note data (linked to user ID)
- `sessions` — Active sessions
