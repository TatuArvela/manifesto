# Manifesto Specification

Manifesto is a free, open-source note-taking application with a simple sticky note interface.

The name references three things:

1. **Personal writings** — note-taking at its core
2. **Free/open-source software ideology** — the manifesto behind the project
3. **Manifesting** — AI-assisted creation of the software itself

## Principles

- **Free and open-source** — MIT licensed, community-driven
- **Local-first** — works fully offline with local data, no server required (open mode)
- **Optionally connected** — connect to any compatible server for multi-device sync, accounts, and multi-user support
- **Managed deployable** — can be configured as a server-only app for organizations (managed mode)
- **Simple** — sticky note interface that gets out of your way
- **Lightweight** — minimal dependencies, fast load times

## Specifications

### Use Cases

- [User Stories](user-stories.md) — Scenarios and acceptance criteria

### Shared Contract

- [Data Model](data-model.md) — Note schema, enums, identifiers
- [API](api.md) — REST and WebSocket interface between client and server

### Features

- [Notes](features/notes.md) — Core CRUD, colors, pinning
- [Checklists](features/checklists.md) — Interactive task lists
- [Locking](features/locking.md) — Lock levels and behavior
- [Search](features/search.md) — Full-text search
- [Tags](features/tags.md) — Organizing notes with tags
- [Archiving](features/archiving.md) — Keeping notes out of the main view
- [Trash](features/trash.md) — Soft delete and auto-expiry
- [Export/Import](features/export-import.md) — Data portability
- [Collaborative Editing](features/collaborative-editing.md) — Live multi-user editing

### Client

- [Client Overview](client/index.md) — Tech stack, architecture, theming
- [Client Deployment](client/deployment.md) — Static hosting, PWA, open/managed mode

### Server

- [Server Overview](server/index.md) — Tech stack, architecture, auth
- [Server Deployment](server/deployment.md) — Docker, environment, reverse proxy
