# Manifesto Specification

Manifesto is a free, open-source note-taking application with a simple sticky note interface.

The name references three things:

1. **Personal writings** — note-taking at its core
2. **Free/open-source software ideology** — the manifesto behind the project
3. **Manifesting** — AI-assisted creation of the software itself

## Principles

- **Free and open-source** — MIT licensed, community-driven
- **Local-first** — works fully offline against `localStorage`, no server required (open mode)
- **Self-hostable** — built with `VITE_MANIFESTO_SERVER=<url>` to talk to a Manifesto server for multi-device sync, accounts, and live collaboration (connected mode)
- **Pluggable backend** — server picks a storage driver (`sqlite` / `postgres`) and an auth provider (`local` / `oidc`) independently, so the same codebase covers personal self-hosts and team deployments
- **Simple** — sticky note interface that gets out of your way
- **Lightweight** — minimal dependencies, fast load times

## Specifications

### Use Cases

- [User Stories](user-stories.md) — Scenarios and acceptance criteria
- [Operating Modes](operating-modes.md) — Open vs connected, storage and auth options, decision matrix

### Shared Contract

- [Data Model](data-model.md) — Note schema, enums, identifiers
- [API](api.md) — REST and WebSocket contract between client and server

### Features

- [Notes](features/notes.md) — Core CRUD, colors, pinning
- [Checklists](features/checklists.md) — Interactive task lists
- [Search](features/search.md) — Full-text search
- [Tags](features/tags.md) — Organizing notes with tags
- [Reminders](features/reminders.md) — Scheduled reminders, with optional recurrence
- [Archiving](features/archiving.md) — Keeping notes out of the main view
- [Trash](features/trash.md) — Soft delete and auto-expiry
- [Export/Import](features/export-import.md) — Data portability
- [Sharing](features/sharing.md) — Share notes via URL
- [Version History](features/version-history.md) — Browse and restore previous versions of notes
- [Collaborative Editing](features/collaborative-editing.md) — Live multi-user editing (planned)

### Client

- [Client Overview](client/index.md) — Tech stack, architecture, theming
- [Client Deployment](client/deployment.md) — Static hosting, PWA, build-time configuration

### Server

- [Server Overview](server/index.md) — Tech stack, architecture, storage drivers, auth providers
- [Server Deployment](server/deployment.md) — Docker, environment, reverse proxy, OIDC setup, Postgres setup
