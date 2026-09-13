# Manifesto

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logo-dark.svg">
  <img src="logo.svg" alt="" width="96">
</picture>

A free, open-source note-taking app with a simple sticky note interface.

- [Local-first](docs/specification/operating-modes.md#open-mode): works in the browser with no server required
- Optionally [self-host a server](docs/specification/operating-modes.md#connected-mode) for multi-device sync, [accounts with admin tools](docs/specification/features/accounts.md), [live collaboration](docs/specification/features/collaborative-editing.md) and [link previews](docs/specification/features/link-previews.md)
- [Markdown](docs/specification/features/notes.md#editing-a-note) and interactive [checklists](docs/specification/features/checklists.md)
- [Tags](docs/specification/features/tags.md), [colors](docs/specification/features/notes.md#colors), [pinning](docs/specification/features/notes.md#pinning), [archiving](docs/specification/features/archiving.md), [reminders](docs/specification/features/reminders.md), [version history](docs/specification/features/version-history.md)
- [Full-text search](docs/specification/features/search.md), [link sharing](docs/specification/features/sharing.md) and plugin-generated [auto-notes](docs/specification/features/auto-notes.md)
- [Export and import](docs/specification/features/export-import.md) your data
- [Rebrandable](docs/specification/custom-instances.md): run it under your own name, description and icons
- [PWA](docs/specification/client/deployment.md#pwa) for mobile and offline use

[Preview](https://tatuarvela.github.io/manifesto/) | [Documentation](docs/specification/index.md) | [Contributing](CONTRIBUTING.md) | [MIT License](LICENSE)

## Built with

- [TypeScript](https://www.typescriptlang.org/) - Programming language
- [Preact](https://preactjs.com/) - UI framework
- [Vite](https://vite.dev/) - Client build and dev server
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Milkdown](https://milkdown.dev/) - Markdown editor
- [Yjs](https://yjs.dev/) - Live collaboration
- [Hono](https://hono.dev/) - Server framework
- [SQLite](https://sqlite.org/) - Default server storage, with [PostgreSQL](https://www.postgresql.org/) as an alternative

## Deployment

Each release ships a client bundle and a server image. The client's [operating mode](docs/specification/operating-modes.md) is fixed at build time, so pick it first.

- [Client](docs/specification/client/deployment.md): `manifesto-client-vX.Y.Z.zip` is an open-mode static site for any static host. A connected-mode client is built from source with `VITE_MANIFESTO_SERVER` set
- [Server](docs/specification/server/deployment.md): `ghcr.io/tatuarvela/manifesto-server` Docker image, run behind an HTTPS reverse proxy

## Configuration

- [Client](docs/specification/client/deployment.md#configuration): build-time `VITE_*` variables, including the server URL that selects the operating mode. See [`.env.example`](packages/client/.env.example)
- [Server](docs/specification/server/deployment.md#environment-variables): runtime environment variables, including the storage driver (`sqlite` or `postgres`) and auth provider (`local` or `oidc`). See [`.env.example`](packages/server/.env.example)
- [Custom instances](docs/specification/custom-instances.md): product name, description and icons, from source or by editing a release bundle

## Security

- [Auto-notes](docs/specification/features/auto-notes.md#execution-and-sandboxing) run user-supplied JavaScript in a sandboxed iframe and worker with an opaque origin and a timeout
- Rendered [Markdown](docs/specification/client/index.md#editor) is sanitized with DOMPurify, and incoming [share links](docs/specification/features/sharing.md#decoding) are validated before display
- The client's [Content Security Policy](docs/specification/client/deployment.md#configuration) only allows connections to its own origin and the configured server
- [Accounts](docs/specification/server/index.md#authentication-providers) use argon2id passwords or OIDC with PKCE, rate-limited login, and sessions with both idle and absolute expiry
- Notes are [isolated per user](docs/specification/server/index.md#multi-user), and collaborative editing checks note ownership
- [Link previews](docs/specification/features/link-previews.md#what-the-server-fetches) are fetched by the server from public addresses only, and their images are stored in the note, so viewing one contacts no third party. `LINK_PREVIEWS=off` disables fetching
- A new server's [initial admin](docs/specification/features/accounts.md#the-initial-admin) gets a random password printed at boot, never a default. Admin-issued passwords are single-use, and a reset signs the account out everywhere, open sockets included
- In production, set `REGISTRATION_ENABLED=false` if accounts should only come from an admin, and `TRUST_PROXY=true` only behind a trusted [reverse proxy](docs/specification/server/deployment.md#reverse-proxy)

If you have found a vulnerability and wish to report it, please [contribute](CONTRIBUTING.md).
