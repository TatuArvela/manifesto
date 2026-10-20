# Operating Modes

Manifesto runs in one of two modes. You select the mode when you build the **client**. The mode
sets where the notes are stored, if authentication is necessary, and which features are available.

| Mode          | Storage             | Login required | Multi-device | Multi-user | Offline      |
|---------------|---------------------|----------------|--------------|------------|--------------|
| **Open**      | Browser localStorage | No             | No           | No         | Always       |
| **Connected** | Manifesto server     | Yes            | Yes          | Yes        | Read-only through the service worker cache |

There is no runtime switch: a build has one mode. To move data between modes, use
[Export / Import](features/export-import.md). To run a mode with your own name and icons, see
[Custom Instances](custom-instances.md).

## Open Mode

This is the default. The client is a standalone single-page application. There is no server to
deploy or operate.

- All notes are in `localStorage`, under the `manifesto:notes` key (JSON). Their images are in
  IndexedDB (`manifesto-images`). A note refers to each image as `local:<sha256>`. See
  [Attachments](features/attachments.md).
- The version history is in `localStorage`, with one key for each note, compressed with LZ-String
  (`manifesto:versions:<noteId>`).
- The preferences are in `localStorage`, under `manifesto:prefs`.
- Sharing works through URL hash payloads. Thus, two open-mode users can share a note without a
  server.
- The PWA service worker caches the app shell. Thus, after installation, the site works fully
  offline.

### Available features

Notes, checklists, tags, colors, pinning, archive, trash, search, reminders, version history,
sharing, import/export, reorder with drag-and-drop, full markdown editing.

### Not available

Sync between devices, accounts for many users, sharing notes with other accounts, server-side search
across devices, live collaborative editing, the titles and images of
[link previews](features/link-previews.md) (cards show only the URL and the domain), and storage
outside one browser profile.

### When to use

- Personal notes on one device.
- Static-site deployments (GitHub Pages, Netlify, Cloudflare Pages, plain nginx).
- Air-gapped environments or offline-first environments.
- To try Manifesto without a server.

### Build

```bash
pnpm install
pnpm --filter @manifesto/client build
# Produces packages/client/dist/; host as a static site.
```

At build time, `VITE_MANIFESTO_SERVER` must not be set (or must be empty). The Content Security
Policy stays at `connect-src 'self'`.

## Connected Mode

The client is built with `VITE_MANIFESTO_SERVER=<url>`. It connects to a Manifesto server for
storage, authentication, and real-time distribution of events. The server is the source of truth.

- The server stores the notes through the configured [storage driver](#storage-drivers).
- Users authenticate through the configured [auth provider](#auth-providers). Login is mandatory.
- Writes go through the REST API. The server sends `note:*` events over the `/api/v1/ws` WebSocket.
  Thus, other devices update immediately.
- Collaborative editing of each note runs over a Hocuspocus and Yjs channel at `/api/v1/yjs`. This
  channel sends all notes over one socket, by document name.
- Each user has their own tags and manual order.
- Most [preferences](features/preferences.md) go with the account. Some that apply to one screen or
  one browser stay on the device.

### Available features

All of the features of open mode, **and**: sync between devices, isolation between users,
[account administration](features/accounts.md),
[sharing notes with other accounts](features/sharing-with-people.md), server-side search, live
collaborative editing, presence (who looks at or edits a note), and
[link previews](features/link-previews.md) with the title, description and image of the page.

### Behavioural differences vs open mode

- The client shows only `LoginScreen` until a session token is present.
- The client cannot use the local-only fallbacks (for example `LocalStorageAdapter`). The device
  keeps no data other than the auth token and the PWA cache.
- Reminders still fire from the `reminderScheduler` of the client, because the user must have the
  tab open to get a notification.
- The version history stays local to the client for now.

### When to use

- Many devices that must stay in sync.
- Teams that need collaborative editing, or isolation of notes between users.
- Organizations that must keep notes on a server (compliance, backups, central administration).

### Build & run

Build the client with the server URL in it, and run the server with it:

```bash
# Client
VITE_MANIFESTO_SERVER=https://server.example.com \
  pnpm --filter @manifesto/client build

# Server (defaults to SQLite + local auth)
pnpm --filter @manifesto/server build
pnpm --filter @manifesto/server start
```

For the hosting details, see [Client Deployment](client/deployment.md) and
[Server Deployment](server/deployment.md).

## Server Configuration

In connected mode, the server selects a **storage driver** and an **auth provider** separately. All
four combinations are supported.

|                       | `AUTH_PROVIDER=local`             | `AUTH_PROVIDER=oidc`                            |
|-----------------------|-----------------------------------|-------------------------------------------------|
| `STORAGE_DRIVER=sqlite`   | Personal or small self-host        | Self-host with company SSO                      |
| `STORAGE_DRIVER=postgres` | Self-host on managed Postgres     | Team or managed deployment with SSO and scale-out  |

### Storage drivers

Both drivers have the same `StorageDriver` interface and six repositories: `users`, `sessions`,
`notes`, `shares`, `yjs`, `maintenance`. The choice is about operation, not about function.

- **`sqlite`** *(default)*: `better-sqlite3`, one file at `${DATA_DIR}/manifesto.db`. It needs no
  configuration. Make a backup with the `.backup` command of SQLite. Never use `cp`. The driver runs
  in WAL mode. Thus, the `.db` file alone is not the full database. See
  [Backups](server/deployment.md#backups).
- **`postgres`**: a `pg` Pool, connected to a `DATABASE_URL`. It is necessary for a deployment that
  has more than one app server, that shares state with other services, or that uses the backups of a
  managed database.

For more data, see [Server Overview](server/index.md#storage-drivers).

### Auth providers

Both providers have the same `AuthProvider` interface. Only the login step is different. After the
server makes a session token, all authenticated requests are the same.

- **`local`** *(default)*: username and argon2id password. The server stores the sessions. It
  mounts `POST /api/v1/auth/{register,login,logout}`.
- **`oidc`**: OAuth 2.0 Authorization Code Flow with PKCE, against an OpenID Connect IdP (Authentik,
  Keycloak, Google, Auth0, Okta, …). It mounts `GET /api/v1/auth/login` (302 to the IdP),
  `GET /api/v1/auth/callback` and `POST /api/v1/auth/logout`. It makes users just in time, by
  `(provider, sub)`.

When the client mounts, it reads the public `GET /api/v1/capabilities` (`auth.providers`) to select
the login UI. Thus, one client build works with both providers.

For more data, see [Server Overview](server/index.md#authentication-providers).

## Migrating Between Modes

You cannot upgrade in place. To move from one mode to the other:

1. **Open → Connected**: in Settings → Export, download the export zip. Build (or open) the
   connected client, and log in. Then use Settings → Import.
2. **Connected → Open**: do the same steps in the opposite direction. Export from the connected
   client, change to an open-mode build, and import.

A round trip keeps all fields of the [data model](data-model.md). This includes the version history
snapshots in the local `manifesto:versions:<noteId>` keys. For export and import, see
[Export / Import](features/export-import.md).

## Configuration Reference

### Client (build time)

| Variable                  | Mode           | Description                                           |
|---------------------------|----------------|-------------------------------------------------------|
| `VITE_MANIFESTO_SERVER`   | Connected only | The absolute URL of the Manifesto server. If not set, the mode is open mode. |

### Server (runtime)

The full list is in `packages/server/.env.example`. These variables control the mode:

| Variable          | Default     | Notes                                          |
|-------------------|-------------|------------------------------------------------|
| `STORAGE_DRIVER`  | `sqlite`    | `sqlite` or `postgres`. The server validates it when it starts. |
| `AUTH_PROVIDER`   | `local`     | `local`, `oidc` or `both`. The server validates it when it starts. |
| `DATABASE_URL`    | none        | Necessary when `STORAGE_DRIVER=postgres`.        |
| `OIDC_*`          | none        | Necessary when `AUTH_PROVIDER=oidc` or `both`. See [Server Deployment](server/deployment.md#oidc-variables-when-auth_provideroidc). |
| `CORS_ORIGINS`    | `http://localhost:5173` | In connected mode, it must include the origin of the deployed client. |
