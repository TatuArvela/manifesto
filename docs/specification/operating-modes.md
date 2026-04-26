# Operating Modes

Manifesto runs in one of two modes, selected when the **client** is built. The mode determines where notes are stored, whether authentication is required, and which features are available.

| Mode          | Storage             | Login required | Multi-device | Multi-user | Offline      |
|---------------|---------------------|----------------|--------------|------------|--------------|
| **Open**      | Browser localStorage | No             | No           | No         | Always       |
| **Connected** | Manifesto server     | Yes            | Yes          | Yes        | Read-only via service worker cache |

There is no runtime toggle — a build is one mode or the other. To move data between modes, use [Export / Import](features/export-import.md).

## Open Mode

The default. The client is a standalone single-page application; there is no server to deploy or operate.

- All notes live in `localStorage` under the `manifesto:notes` key (JSON).
- Version history lives in `localStorage` under `manifesto:versions` (LZ-String compressed).
- Preferences live in `localStorage` under `manifesto:prefs`.
- Sharing works via URL hash payloads, so any two open-mode users can share a note without a server.
- The PWA service worker caches the app shell, so the site works fully offline once installed.

### Available features

Notes, checklists, tags, colors, pinning, archive, trash, search, reminders, version history, sharing, import/export, drag-and-drop reordering, full markdown editing.

### Not available

Multi-device sync, multi-user accounts, server-side search across devices, live collaborative editing, persistence beyond a single browser profile.

### When to use

- Personal note-taking on a single device.
- Static-site deployments (GitHub Pages, Netlify, Cloudflare Pages, plain nginx).
- Air-gapped or offline-first environments.
- Trying Manifesto without committing to a server.

### Build

```bash
pnpm install
pnpm --filter @manifesto/client build
# Produces packages/client/dist/ — host as a static site.
```

`VITE_MANIFESTO_SERVER` must be unset (or empty) at build time. The Content Security Policy stays at `connect-src 'self'`.

## Connected Mode

The client is built with `VITE_MANIFESTO_SERVER=<url>` and talks to a Manifesto server for persistence, authentication, and real-time fan-out. The server is the source of truth.

- Notes are stored server-side via the configured [storage driver](#storage-drivers).
- Users authenticate via the configured [auth provider](#auth-providers); login is mandatory.
- Writes go through the REST API; the server fans out `note:*` events over the `/api/ws` WebSocket so other devices update live.
- Per-note collaborative editing runs over a Hocuspocus + Yjs channel at `/api/yjs/notes/<id>`.
- Tags and manual ordering are scoped per-user.

### Available features

Everything in open mode, **plus**: multi-device sync, multi-user isolation, server-side search, live collaborative editing, presence (who is viewing/editing).

### Behavioural differences vs open mode

- The client gates the entire UI behind `LoginScreen` until a session token is present.
- Local-only fallbacks (e.g. `LocalStorageAdapter`) are not reachable; data never lives on the device beyond the auth token and PWA cache.
- Reminders still fire from the client's `reminderScheduler`, since the user must have the tab open to be notified.
- Version history remains client-local for now.

### When to use

- Multiple devices that need to stay in sync.
- Teams that want collaborative editing or per-user note isolation.
- Organizations that need to retain notes server-side (compliance, backups, central admin).

### Build & run

Build the client with the server URL baked in, and run the server alongside it:

```bash
# Client
VITE_MANIFESTO_SERVER=https://server.example.com \
  pnpm --filter @manifesto/client build

# Server (defaults to SQLite + local auth)
pnpm --filter @manifesto/server build
pnpm --filter @manifesto/server start
```

See [Client Deployment](client/deployment.md) and [Server Deployment](server/deployment.md) for hosting specifics.

## Server Configuration

In connected mode the server picks a **storage driver** and an **auth provider** independently. All four combinations are supported.

|                       | `AUTH_PROVIDER=local`             | `AUTH_PROVIDER=oidc`                            |
|-----------------------|-----------------------------------|-------------------------------------------------|
| `STORAGE_DRIVER=sqlite`   | Personal / small self-host        | Self-host with company SSO                      |
| `STORAGE_DRIVER=postgres` | Self-host on managed Postgres     | Team / managed deployment with SSO + scale-out  |

### Storage drivers

Both drivers expose the same `StorageDriver` interface and ship five repositories: `users`, `sessions`, `notes`, `yjs`, `maintenance`. The choice is operational, not functional.

- **`sqlite`** *(default)* — `better-sqlite3`, single file at `${DATA_DIR}/manifesto.db`. Zero configuration. Back up by copying the file.
- **`postgres`** — `pg` Pool against a `DATABASE_URL`. Required for any deployment that scales beyond a single app server, shares state with other services, or relies on managed-database backups.

See [Server Overview](server/index.md#storage-drivers) for details.

### Auth providers

Both providers expose the same `AuthProvider` interface. Only the login step differs; once a session token is minted, every authenticated request is identical.

- **`local`** *(default)* — username + argon2id password, sessions stored server-side. Mounts `POST /api/auth/{register,login,logout}`.
- **`oidc`** — OAuth 2.0 Authorization Code Flow with PKCE against any OpenID Connect IdP (Authentik, Keycloak, Google, Auth0, Okta, …). Mounts `GET /api/auth/login` (302 to IdP), `GET /api/auth/callback`, `POST /api/auth/logout`. Users are JIT-provisioned by `(provider, sub)`.

The client decides which login UI to render by hitting the public `GET /api/auth/methods` endpoint on mount, so a single client build works against either provider.

See [Server Overview](server/index.md#authentication-providers) for details.

## Migrating Between Modes

There is no in-place upgrade. To move from one mode to another:

1. **Open → Connected** — Settings → Export to download `manifesto-export.json`, build (or visit) the connected client, log in, then Settings → Import.
2. **Connected → Open** — Same flow in reverse: export from the connected client, switch to an open-mode build, import.

Round-trips preserve every field in the [data model](data-model.md), including version history snapshots referenced via the local `manifesto:versions` key. Export/import is documented in [Export / Import](features/export-import.md).

## Configuration Reference

### Client (build time)

| Variable                  | Mode           | Description                                           |
|---------------------------|----------------|-------------------------------------------------------|
| `VITE_MANIFESTO_SERVER`   | Connected only | Absolute URL of the Manifesto server. Unset → open mode. |

### Server (runtime)

The full list lives in `packages/server/.env.example`. The mode-shaping subset:

| Variable          | Default     | Notes                                          |
|-------------------|-------------|------------------------------------------------|
| `STORAGE_DRIVER`  | `sqlite`    | `sqlite` or `postgres`. Validated at boot.     |
| `AUTH_PROVIDER`   | `local`     | `local` or `oidc`. Validated at boot.          |
| `DATABASE_URL`    | —           | Required when `STORAGE_DRIVER=postgres`.        |
| `OIDC_*`          | —           | Required when `AUTH_PROVIDER=oidc`. See [Server Deployment](server/deployment.md#oidc-variables-when-auth_provideroidc). |
| `CORS_ORIGINS`    | `http://localhost:5173` | Must include the deployed client origin in connected mode. |
