# Manifesto

A free, open-source note-taking app with a simple sticky note interface.

- Local-first — works in the browser with no server required
- Optionally self-host a server for multi-device sync, accounts, and live collaboration
- Markdown and interactive checklists
- Tags, colors, pinning, archiving, reminders, version history
- Export and import your data
- PWA for mobile and offline use

## Operating Modes

Manifesto runs in one of two modes, picked when the client is built:

- **Open mode** *(default)* — Static SPA backed by browser `localStorage`. No server, no login, fully offline. Drop the built `dist/` onto any static host.
- **Connected mode** — Client built with `VITE_MANIFESTO_SERVER=<url>` talks to a Manifesto server for storage, accounts, and live sync. The server picks a storage driver (`sqlite` or `postgres`) and an auth provider (`local` username/password or `oidc` SSO) independently — all four combinations are supported.

See [Operating Modes](docs/specification/operating-modes.md) for the full breakdown, including a decision matrix and migration path.

## Documentation

The full specification lives in [docs/specification/](docs/specification/index.md):

- [Operating Modes](docs/specification/operating-modes.md) — Open vs connected, storage and auth options
- [Data Model](docs/specification/data-model.md) and [API](docs/specification/api.md) — Wire contract
- [Client](docs/specification/client/index.md) and [Server](docs/specification/server/index.md) — Architecture
- [Features](docs/specification/index.md#features) — Notes, checklists, search, tags, sharing, version history, …
- [Releasing](docs/development/releasing.md) — How releases are cut

## License

MIT
