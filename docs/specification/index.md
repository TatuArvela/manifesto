# Manifesto Specification

Manifesto is a free, open-source application for notes. It has a simple interface of sticky notes.

The name refers to three things:

1. **Personal writings**: the main function is to write notes.
2. **The ideology of free and open-source software**: the manifesto behind the project.
3. **Manifesting**: an AI helped to make the software.

## Principles

- **Free and open-source**: it has the MIT license, and the community drives it.
- **Local-first**: it works fully offline with `localStorage`, and it needs no server (open mode).
- **Self-hostable**: build it with `VITE_MANIFESTO_SERVER=<url>`, and it connects to a Manifesto server. The server gives sync between devices, accounts, and live collaboration (connected mode).
- **Pluggable backend**: the server selects a storage driver (`sqlite` / `postgres`) and an auth provider (`local` / `oidc`) separately. Thus, the same code is correct for a personal self-host and for a team deployment.
- **Rebrandable**: the product name, description and icons are deployment parameters. Thus, an organization can run it as its own app.
- **Simple**: the interface of sticky notes does not prevent your work.
- **Lightweight**: it has few dependencies, and it loads quickly.

[Non-goals](non-goals.md) tells what Manifesto decided not to do, and why.

## Specifications

### Use Cases

- [User Stories](user-stories.md): scenarios and acceptance criteria
- [Operating Modes](operating-modes.md): open mode and connected mode, storage and auth options, a decision matrix
- [Custom Instances](custom-instances.md): how to deploy Manifesto with your own name, icons and description
- [Accessibility](accessibility.md): the WCAG 2.1 AA target, known gaps, and what a deployment possibly must publish
- [Non-goals](non-goals.md): features and architecture that Manifesto decided not to have

### Shared Contract

- [Data Model](data-model.md): note schema, enums, identifiers
- [API](api.md): the REST and WebSocket contract between the client and the server

### Features

- [Notes](features/notes.md): the main operations (create, read, update, delete), colors, pinning
- [Checklists](features/checklists.md): interactive task lists
- [Search](features/search.md): full-text search
- [Keyboard Shortcuts](features/keyboard-shortcuts.md): single-key shortcuts on the board
- [Tags](features/tags.md): how to organize notes with tags
- [Reminders](features/reminders.md): scheduled reminders, which can repeat
- [Archiving](features/archiving.md): how to keep notes out of the main view
- [Trash](features/trash.md): soft delete and automatic expiry
- [Export/Import](features/export-import.md): how to move your data
- [Attachments](features/attachments.md): images inline in open mode, and in the attachment store of the server in connected mode
- [Drawing Pad](features/drawing-pad.md): drawings and changes to images, in layers, which go on a note as images
- [Sharing](features/sharing.md): how to share notes through a URL
- [Sharing with People](features/sharing-with-people.md): how to share notes with other accounts, to edit or to view (connected mode)
- [Link Previews](features/link-previews.md): cards for pasted links, which the server fills in connected mode
- [Version History](features/version-history.md): how to see and restore previous versions of notes
- [Auto-notes](features/auto-notes.md): cards that plugins from the user make
- [Collaborative Editing](features/collaborative-editing.md): live editing by many users
- [Webhooks](features/webhooks.md): note events that the server sends to URLs that a user selects (connected mode)
- [MCP](features/mcp.md): tools for AI assistants through the Model Context Protocol (connected mode)
- [Preferences](features/preferences.md): settings that the device keeps, and that go with the account in connected mode
- [Privacy](features/privacy.md): who can read notes, what admins see, and what a user can see about their own account
- [Encryption](features/encryption.md): end-to-end encryption for all accounts in connected mode. It tells the design, what is built, and what it does not protect.
- [Account Administration](features/accounts.md): admins, temporary passwords and the Users view (connected mode)

### Client

- [Client Overview](client/index.md): technologies, architecture, themes
- [Client Deployment](client/deployment.md): static hosting, PWA, configuration at build time

### Server

- [Server Overview](server/index.md): technologies, architecture, storage drivers, auth providers
- [Server Deployment](server/deployment.md): Docker, environment, reverse proxy, OIDC setup, Postgres setup
