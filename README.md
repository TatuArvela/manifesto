# Manifesto

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logo-dark.svg">
  <img src="logo.svg" alt="" width="96">
</picture>

Manifesto is a free, open-source app for notes. It has a simple interface of sticky notes.

- [Local-first](docs/specification/operating-modes.md#open-mode): it works in the browser, and it does not need a server.
- You can [self-host a server](docs/specification/operating-modes.md#connected-mode). The server gives sync between devices, [accounts with admin tools](docs/specification/features/accounts.md), [live collaboration](docs/specification/features/collaborative-editing.md), [link previews](docs/specification/features/link-previews.md) and an [MCP endpoint](docs/specification/features/mcp.md) for AI assistants.
- [Markdown](docs/specification/features/notes.md#editing-a-note) and interactive [checklists](docs/specification/features/checklists.md).
- [Tags](docs/specification/features/tags.md), [colors](docs/specification/features/notes.md#colors), [pinning](docs/specification/features/notes.md#pinning), [archiving](docs/specification/features/archiving.md), [reminders](docs/specification/features/reminders.md) and [version history](docs/specification/features/version-history.md).
- [Full-text search](docs/specification/features/search.md), [link sharing](docs/specification/features/sharing.md) and [auto-notes](docs/specification/features/auto-notes.md), which plugins make.
- [Export and import](docs/specification/features/export-import.md) of your data.
- [Rebrandable](docs/specification/custom-instances.md): you can run it with your own name, description and icons.
- [PWA](docs/specification/client/deployment.md#pwa) for mobile use and offline use.

[Preview](https://tatuarvela.github.io/manifesto/) | [Documentation](docs/specification/index.md) | [Contributing](CONTRIBUTING.md) | [MIT License](LICENSE)

## Built with

- [TypeScript](https://www.typescriptlang.org/): programming language
- [Preact](https://preactjs.com/): UI framework
- [Vite](https://vite.dev/): client build and dev server
- [Tailwind CSS](https://tailwindcss.com/): styles
- [Milkdown](https://milkdown.dev/): Markdown editor
- [Yjs](https://yjs.dev/): live collaboration
- [Hono](https://hono.dev/): server framework
- [SQLite](https://sqlite.org/): default server storage. [PostgreSQL](https://www.postgresql.org/) is an alternative.

## Deployment

Each release has a client bundle and a server image. The build sets the [operating mode](docs/specification/operating-modes.md) of the client. Thus, select the mode first.

- [Client](docs/specification/client/deployment.md): `manifesto-client-vX.Y.Z.zip` is an open-mode static site for any static host. To connect it to a server, edit two lines of its `index.html`. For all other connected-mode clients, build from source with `VITE_MANIFESTO_SERVER` set.
- [Server](docs/specification/server/deployment.md): the `ghcr.io/tatuarvela/manifesto-server` Docker image. Run it behind an HTTPS reverse proxy.

## Configuration

- [Client](docs/specification/client/deployment.md#configuration): `VITE_*` variables at build time. One of them is the server URL, which selects the operating mode. See [`.env.example`](packages/client/.env.example).
- [Server](docs/specification/server/deployment.md#environment-variables): environment variables at runtime. They include the storage driver (`sqlite` or `postgres`) and the auth provider (`local` or `oidc`). See [`.env.example`](packages/server/.env.example).
- [Custom instances](docs/specification/custom-instances.md): the product name, description and icons. Set them in the source, or edit a release bundle.

## Security

- [Auto-notes](docs/specification/features/auto-notes.md#execution-and-sandboxing) run JavaScript that the user supplies. The code runs in a sandboxed iframe and worker, with an opaque origin and a timeout.
- DOMPurify sanitizes rendered [Markdown](docs/specification/client/index.md#editor). The app validates incoming [share links](docs/specification/features/sharing.md#decoding) before it shows them.
- The [Content Security Policy](docs/specification/client/deployment.md#configuration) of the client permits connections only to its own origin and to the configured server. The fonts are in the bundle. Thus, the client does not contact a third party.
- [Accounts](docs/specification/server/index.md#authentication-providers) use argon2id passwords or OIDC with PKCE. Login has a rate limit. Sessions have an idle expiry and an absolute expiry.
- The server [isolates the notes of each user](docs/specification/server/index.md#multi-user). Collaborative editing checks the owner of the note.
- The server gets [link previews](docs/specification/features/link-previews.md#what-the-server-fetches) only from public addresses. Their images go into the note. Thus, when you look at a preview, the app does not contact a third party. `LINK_PREVIEWS=off` stops the fetches.
- The [initial admin](docs/specification/features/accounts.md#the-initial-admin) of a new server gets a random password, which the server prints when it starts. It never gets a default password. A password that an admin gives can be used one time only. A reset signs the account out on all devices, and closes the open sockets too.
- Server images are [signed, and have an SBOM and build provenance](docs/specification/server/deployment.md#what-is-in-an-image). A scan for known vulnerabilities runs each week.
- In production, set `REGISTRATION_ENABLED=false` if only an admin must make accounts. Set `TRUST_PROXY=true` only behind a trusted [reverse proxy](docs/specification/server/deployment.md#reverse-proxy).

To report a vulnerability, see [SECURITY.md](SECURITY.md).
