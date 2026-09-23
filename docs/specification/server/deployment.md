# Server Deployment

The server carries no branding: it is a JSON + WebSocket API with no HTML, no icons, and no product name in any response. A rebranded deployment runs this image unmodified; see [Custom Instances](../custom-instances.md).

## Running Directly

```bash
pnpm install
pnpm --filter @manifesto/server build
pnpm --filter @manifesto/server start
```

## Docker

Each release publishes a multi-arch image, so there is nothing to build. Pin the
tag to the release you mean to run:

```yaml
services:
  manifesto-server:
    image: ghcr.io/tatuarvela/manifesto-server:X.Y.Z
    ports:
      - "3001:3001"
    volumes:
      - manifesto-data:/app/data
    environment:
      CORS_ORIGINS: https://notes.example.com
volumes:
  manifesto-data:
```

```bash
docker compose up -d
```

Data persists across container restarts via the volume mount.

The published port is for trying the server out directly. Behind a reverse
proxy, drop it: see [Do not publish the server port](#do-not-publish-the-server-port).

### Building the image yourself

Working on the server, or running a commit no release covers? The Dockerfile
lives at `packages/server/Dockerfile`. Build with the repo root as the build
context so the workspace manifests are reachable:

```yaml
services:
  manifesto-server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
```

```bash
docker compose up --build
```

`/api/health` reports the server's version. The build context has no `.git`, so an image built this way reports the release number from `package.json` even when it is built from a later commit. To report the exact build, resolve the version on the host and pass it in as a build arg:

```bash
docker build -f packages/server/Dockerfile \
  --build-arg MANIFESTO_VERSION="$(node packages/build-version/src/cli.ts)" .
```

With Compose, list `MANIFESTO_VERSION` under `build.args` and export it before `docker compose up --build`.

## Environment Variables

See `packages/server/.env.example` for the full list and defaults.

| Variable           | Default                    | Description                              |
|--------------------|----------------------------|------------------------------------------|
| `PORT`             | `3001`                     | Server port                              |
| `STORAGE_DRIVER`   | `sqlite`                   | Storage driver: `sqlite` or `postgres`.  |
| `AUTH_PROVIDER`    | `local`                    | Auth provider: `local`, `oidc`, or `both` side by side (see below). |
| `PASSWORD_FORM`    | `shown`                    | With `AUTH_PROVIDER=both`: `shown` puts the password form under the single sign-on button, `collapsed` folds it behind a "Sign in with a password instead" link, for servers where SSO is the way in and local accounts are the admin's spare key. |
| `DATA_DIR`         | `./data`                   | Directory for the SQLite database        |
| `MANIFESTO_DB`     | `${DATA_DIR}/manifesto.db` | Override the SQLite path explicitly      |
| `DATABASE_URL`     | _(required for postgres)_  | Postgres connection string               |
| `CORS_ORIGINS`     | `http://localhost:5173`    | Comma-separated allowed client origins   |
| `SESSION_TTL_DAYS` | `30`                       | Session inactivity timeout in days       |
| `SESSION_ABSOLUTE_TTL_DAYS` | `90`              | Hard session lifetime in days, measured from login. A session in constant use still ends here, so a stolen token can't live forever. |
| `LOG_LEVEL`        | `info`                     | One of debug / info / warn / error       |
| `ARGON2_MEMORY_KIB` | `19456`                   | argon2id memory cost (local auth only)   |
| `ARGON2_TIME_COST`  | `2`                       | argon2id time cost (local auth only)     |
| `ARGON2_PARALLELISM` | `1`                      | argon2id parallelism (local auth only)   |
| `REGISTRATION_ENABLED` | `true`                  | Allow public POST `/api/auth/register`. Set `false` when accounts should only come from an admin, who creates them from the Users view. Registering never makes anyone an admin. |
| `INITIAL_ADMIN_PASSWORD` | _(generated)_          | The temporary password for the initial `admin` account, instead of a generated one that is printed at boot. 8 to 256 characters. It still has to be changed at first sign-in. Local auth only. See [The initial admin](../features/accounts.md#the-initial-admin). |
| `TRUST_PROXY`      | `false`                    | Honor `X-Forwarded-For` for IP-aware rate limiting. Set `true` only behind a trusted reverse proxy that overwrites the header, and make sure it does: the value is taken at its word. An IPv6 client is throttled on its /64 rather than its address, an IPv4 one on its address. |
| `USER_LOOKUP`      | `search`                   | How someone [sharing a note](../features/sharing-with-people.md) finds the person to share it with. `search` suggests accounts by username, display name or email as they type, showing the address. `exact` finds an account only by its whole username or email address and never shows the address, so the list of accounts cannot be browsed. |
| `WEBHOOKS`         | `public`                   | Whether users may add [webhooks](../features/webhooks.md), and where they may point: `public` addresses only, `private` to also reach the local network (a Home Assistant or n8n beside the server), or `off`. |
| `LINK_PREVIEWS`    | `on`                       | Fetch linked pages to fill in [link previews](../features/link-previews.md). The server then makes outbound HTTP(S) requests to public addresses only. Set `off` where it has no internet access or should make no outbound requests; cards then stay plain. |

Both `STORAGE_DRIVER` and `AUTH_PROVIDER` are validated at boot. An unknown value fails fast with a clear error.

### First sign-in

With local sign-in on (`AUTH_PROVIDER=local` or `both`), a new server creates an `admin` account and prints its temporary password to
standard error on boot, regardless of `LOG_LEVEL`:

```bash
docker compose logs manifesto-server | grep temporaryPassword
```

Sign in as `admin` with that password and choose your own. Until you do, each restart prints a new one.
See [The initial admin](../features/accounts.md#the-initial-admin). With `AUTH_PROVIDER=oidc`, the first
person to sign in through the identity provider is the admin instead.

### Local and single sign-on together

`AUTH_PROVIDER=both` offers both at once: the sign-in screen shows the single sign-on button, then the
password form (or a link to it, with `PASSWORD_FORM=collapsed`). Sessions are the same whichever way
someone signed in, and the `users` table holds both kinds of account. Accounts from the identity
provider sign in only through it; local accounts, the initial admin among them, only with their
password, so the server stays reachable if the identity provider is down. Admins can create local
accounts and issue temporary passwords, as under `local`. `OIDC_*` is required as for `oidc`.

### OIDC variables (when `AUTH_PROVIDER=oidc` or `both`)

All of these are required and validated at boot. The server only reads them when the OIDC provider is selected.

| Variable                    | Description                                                                 |
|-----------------------------|-----------------------------------------------------------------------------|
| `OIDC_ISSUER`               | Issuer URL (used for OIDC discovery, e.g. `https://idp.example.com`)       |
| `OIDC_CLIENT_ID`            | Client ID registered with the IdP                                           |
| `OIDC_CLIENT_SECRET`        | Client secret registered with the IdP                                       |
| `OIDC_REDIRECT_URI`         | Server callback URL; must end in `/api/auth/callback`                      |
| `OIDC_POST_LOGIN_REDIRECT`  | Client-side URL to redirect to after successful login (token in fragment)   |
| `OIDC_SCOPES`               | Comma-separated scopes (default `openid,profile,email`)                     |

The login flow:

1. The client fetches `GET /api/auth/methods` and renders a "Continue with single sign-on" button when the response is `{ provider: "oidc" }`.
2. The user clicks the button, navigating to `<server>/api/auth/login`. The server stores PKCE state server-side and redirects to the IdP authorization endpoint.
3. After the user consents, the IdP redirects to `OIDC_REDIRECT_URI` with `code` and `state`.
4. The server verifies state, exchanges the code (PKCE), reads ID-token claims, just-in-time provisions a user (keyed by `(provider, sub)`), and mints a Manifesto session token.
5. The server redirects to `OIDC_POST_LOGIN_REDIRECT#token=<sessionToken>`.
6. The client picks up the fragment on first paint, calls `GET /api/auth/me` with the bearer token to fetch the user record, populates its auth signals, and clears the fragment from the address bar.

The session token is then sent as `Authorization: Bearer <token>` against the rest of the API, identical to the local provider. Logout (`POST /api/auth/logout`) invalidates the local session; it does not perform IdP-side logout (RP-initiated logout is not implemented in v1).

Set `OIDC_POST_LOGIN_REDIRECT` to the deployed client URL (e.g. `https://notes.example.com/`). The client app handles the `#token=...` fragment automatically, so no extra route is needed on the client side.

#### Worked example: Authentik

```text
OIDC_ISSUER=https://auth.example.com/application/o/manifesto/
OIDC_CLIENT_ID=manifesto
OIDC_CLIENT_SECRET=<from Authentik provider page>
OIDC_REDIRECT_URI=https://server.example.com/api/auth/callback
OIDC_POST_LOGIN_REDIRECT=https://notes.example.com/auth-callback
OIDC_SCOPES=openid,profile,email
AUTH_PROVIDER=oidc
```

In Authentik, configure the application's redirect URI to match `OIDC_REDIRECT_URI` exactly. Other IdPs (Keycloak, Google, Okta, Auth0, Authelia) work the same way; only the `OIDC_ISSUER` differs.

## Postgres deployment

For larger or scale-out deployments, set `STORAGE_DRIVER=postgres` and `DATABASE_URL=...`. The schema is created on first boot and brought forward on every boot after that; see [Schema migrations](index.md#schema-migrations).

```yaml
services:
  manifesto-db:
    image: postgres:16
    environment:
      POSTGRES_DB: manifesto
      POSTGRES_USER: manifesto
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - manifesto-pg:/var/lib/postgresql/data
  manifesto-server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    depends_on: [manifesto-db]
    environment:
      STORAGE_DRIVER: postgres
      DATABASE_URL: postgres://manifesto:${POSTGRES_PASSWORD}@manifesto-db:5432/manifesto
      CORS_ORIGINS: https://notes.example.com
    ports:
      - "3001:3001"
volumes:
  manifesto-pg:
```

Yjs document state lives in a `BYTEA` column on `notes`. For very high collaborative-editing throughput, consider terminating Hocuspocus persistence in Redis and treating Postgres as the cold store, but for typical note-taking workloads the single-table model is fine.

## Backups

**Back up the SQLite database with `.backup`, never with `cp`.** The driver opens
every database with `journal_mode = WAL` (`storage/sqlite/database.ts`), and
under WAL a committed transaction is durable as soon as it reaches
`manifesto.db-wal`. It moves into `manifesto.db` only at a checkpoint, so a copy
of `manifesto.db` alone can be missing notes that were saved days ago. What
makes this worth stating twice is that it is silent at both ends: the copy is a
valid, openable, `integrity_check`-clean database, and nothing looks wrong until
someone goes looking for a note that is not there. Copying all three files
(`.db`, `-wal`, `-shm`) from a running server is no better, since nothing holds
the three still while you read them.

`.backup` consolidates the WAL, cannot catch a write half-finished, and runs
while the server keeps serving. The image ships no `sqlite3` binary and runs as
a non-root user, so `docker exec` cannot do this; run a throwaway container
against the volume instead:

```bash
docker run --rm \
  -v <project>_manifesto-data:/data \
  -v "$PWD":/out \
  alpine:3 sh -c '
    apk add --no-cache sqlite >/dev/null &&
    sqlite3 /data/manifesto.db ".backup /out/manifesto-backup.db" &&
    sqlite3 /out/manifesto-backup.db "pragma integrity_check"'
```

Mount `/data` **writable**. Opening a WAL database even to read it means
touching the `-shm` file, so a `:ro` mount fails to open it at all. Check the
integrity of the copy rather than the live database, as above: that is the file
you will restore from, and it is the one that can be truncated.

To restore, stop the server, replace `manifesto.db` in the volume with the
backup, and delete any `-wal` and `-shm` left beside it. Then start the server.

**The database is the whole backup.** `DATA_DIR` sites the SQLite file and
nothing else (`config.ts`), and images are base64 `data:` URLs inside note rows
rather than files on disk (see [Data Model](../data-model.md)), so there is no
second thing to copy.

With `STORAGE_DRIVER=postgres` this section does not apply: back up with
`pg_dump` or whatever the managed database offers, which is one of the reasons
to choose it.

## Reverse Proxy

Run the server behind a reverse proxy that terminates HTTPS. It must pass
WebSocket upgrades through for `/api/ws` (application events) and `/api/yjs`
(collaborative editing); most proxies do that on their own for a proxied route,
so the two rarely need blocks of their own.

Two things below are easy to get wrong in ways nothing reports.

### `X-Forwarded-For` must be overwritten, not appended

With `TRUST_PROXY=true` the server keys its per-IP throttling on the
**leftmost** value of `X-Forwarded-For`. That is the correct read for a proxy
that *overwrites* the header, and the wrong one for a proxy that *appends* to
it, because an appending proxy puts whatever the client sent in front of the
address it actually observed. Set `TRUST_PROXY=true` only with a proxy
configured to overwrite, and only when nothing can reach the server except
through it.

- **nginx**: `proxy_set_header X-Forwarded-For $remote_addr;`
  Do **not** use `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
  which is the line most nginx tutorials give. `$proxy_add_x_forwarded_for` is
  defined as the incoming header plus `$remote_addr`, so it appends, and the
  value the server then trusts is one the client chose. On `/api/auth/login`
  that makes the argon2 verify budget per attacker unbounded.
- **Caddy**: `header_up X-Forwarded-For {http.request.remote.host}` inside
  `reverse_proxy`. Recent Caddy already replaces an untrusted client's header
  rather than appending, but writing it makes the behaviour a property of your
  config rather than of the image tag you happen to have pulled.
- **Traefik**: the address the server sees comes from the entrypoint's
  `forwardedHeaders` trust configuration; set `trustedIPs` to the proxy in
  front of Traefik, or nothing at all when Traefik is the edge.

Leave `TRUST_PROXY` at `false` if you are unsure. The cost is that every client
shares one throttling bucket, which is far cheaper than a bucket per forged
header.

### Do not publish the server port

The compose examples above map `ports: ["3001:3001"]`, which is right for a
local trial and wrong the moment a proxy is in front of it. A published port
plus `TRUST_PROXY=true` makes the proxy a suggestion rather than a chokepoint:
anything that can reach the host on 3001 sets its own `X-Forwarded-For` and is
believed. Behind a proxy the server should have no `ports` at all, and the proxy
should reach it over the compose network by service name.

### Single origin behind one reverse proxy

Serving the client bundle and proxying `/api/*` from **one** origin is the
recommended shape for a one-box deployment. It removes CORS from the picture
entirely: no preflights, no `CORS_ORIGINS` list to keep in step with a rename,
one certificate, one DNS record, and no published server port. Nothing in the
app resists it, both WebSockets included.

`CORS_ORIGINS` then never comes into play, since no browser request is ever
cross-origin, and its `http://localhost:5173` default is harmless. Worth knowing
because a missing `CORS_ORIGINS` is the first thing an operator suspects when
something breaks, and on a single origin it is never the cause.

```yaml
services:
  manifesto-server:
    image: ghcr.io/tatuarvela/manifesto-server:X.Y.Z
    # No `ports`: only the proxy reaches it, over the compose network.
    volumes:
      - manifesto-data:/app/data
    environment:
      TRUST_PROXY: "true"
  caddy:
    image: caddy:2-alpine
    depends_on:
      manifesto-server:
        condition: service_healthy
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./client-dist:/srv:ro
      - caddy-data:/data
volumes:
  manifesto-data:
  caddy-data:
```

```caddy
notes.example.com {
    encode zstd gzip

    header {
        Content-Security-Policy "frame-ancestors 'self'"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }

    # Both WebSockets live under here. reverse_proxy passes an Upgrade
    # through on its own, so /api/ws and /api/yjs need no separate block.
    handle /api/* {
        reverse_proxy manifesto-server:3001 {
            header_up X-Forwarded-For {http.request.remote.host}
        }
    }

    # Content-hashed filenames, cacheable forever. Bundled note fonts too.
    handle /assets/* {
        root * /srv
        header Cache-Control "public, max-age=31536000, immutable"
        file_server
    }

    handle {
        root * /srv
        # no-cache means revalidate, not "do not store". The shell and the
        # service worker have stable names, so a cached copy would outlive a
        # deploy, and the PWA only updates if the browser re-asks for sw.js.
        header Cache-Control "no-cache"
        try_files {path} /index.html
        file_server
    }
}
```

Two details in there were learned the hard way. Caddy's `handle` blocks are
mutually exclusive, so a `header` block written *inside* the last one reaches
nothing the earlier blocks serve: the JS bundle, the fonts and every API
response go out with no `nosniff` while the config reads as though they do not.
And the `Cache-Control` split is what keeps the PWA updating: cache the shell
and `sw.js` without revalidation and the browser never re-asks for the new
service worker, so the self-update path described in
[Client Deployment](../client/deployment.md#pwa) quietly stops working.

The split-origin examples elsewhere in this document remain the right shape when
the client lives somewhere the server does not, such as a CDN or GitHub Pages.
Those do need `CORS_ORIGINS` set to the client's origin.
