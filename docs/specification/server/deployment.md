# Server Deployment

The server is a JSON + WebSocket API. The published image also carries a built client and serves it at
the site root (`CLIENT_DIR`), so one container is a whole connected-mode deployment on one origin; see
[One container](#one-container). The API itself carries no branding, and the client in the image is the
stock build: a rebranded deployment points `CLIENT_DIR` at its own build, or hosts it separately; see
[Custom Instances](../custom-instances.md).

## Running Directly

```bash
pnpm install
pnpm --filter @manifesto/server build
pnpm --filter @manifesto/server start
```

## Docker

### One container

The image serves the client too: open `http://localhost:3001/` and sign in. The client in it is built
with its server set to `/`, so it talks to the container it came from, on the same origin: no
`CORS_ORIGINS`, no `VITE_MANIFESTO_SERVER`, and the client's `connect-src 'self'` already reaches the API
and both sockets. The server adds the headers a `<meta>` CSP cannot carry (`frame-ancestors`,
`X-Frame-Options`), caches hashed assets for good, revalidates the page and service worker, and answers
any client route with the page. Put HTTPS in front of it and that is the deployment.

`CLIENT_DIR` (set to `/app/public` in the image) is what turns this on. Point it at another build (a
rebranded one, mounted into the container) to serve that instead, or unset it to run the API alone
behind a client hosted elsewhere. Open mode and GitHub Pages stay the static client, as before.

### What is in an image

Every published image carries an SBOM (the packages inside it) and a build provenance attestation (the
repository, commit and workflow that built it), both attached in the registry:

```bash
docker buildx imagetools inspect ghcr.io/tatuarvela/manifesto-server:X.Y.Z --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/tatuarvela/manifesto-server:X.Y.Z --format '{{ json .Provenance }}'
```

Images from releases before this was added carry neither.

### Compose files

The repository root has two, kept at the current release by release-please along with the packages:

- [`compose.yaml`](../../../compose.yaml): the one container, SQLite on a volume, daily backups on.
- [`compose.postgres.yaml`](../../../compose.postgres.yaml): the same beside a Postgres, with
  `POSTGRES_PASSWORD` taken from the environment or a `.env` file.

Download one, uncomment what applies (each variable is documented below), and `docker compose up -d`.
Anything beyond (HTTPS, a proxy, OIDC) is in the sections that follow.

### Releases

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
| `REGISTRATION_ENABLED` | `true`                  | Allow public POST `/api/auth/register`. Set `false` when accounts should only come from an admin, who creates them from the Users view. Registering never makes anyone an admin. With it off, the login screen has no Create account tab. |
| `INITIAL_ADMIN_PASSWORD` | _(generated)_          | The temporary password for the initial `admin` account, instead of a generated one that is printed at boot. 8 to 256 characters. It still has to be changed at first sign-in. Local auth only. See [The initial admin](../features/accounts.md#the-initial-admin). |
| `TRUST_PROXY`      | `false`                    | Honor `X-Forwarded-For` for IP-aware rate limiting. Set `true` only behind a trusted reverse proxy that overwrites the header, and make sure it does: the value is taken at its word. An IPv6 client is throttled on its /64 rather than its address, an IPv4 one on its address. |
| `USER_LOOKUP`      | `search`                   | How someone [sharing a note](../features/sharing-with-people.md) finds the person to share it with. `search` suggests accounts by username, display name or email as they type, showing the address. `exact` finds an account only by its whole username or email address and never shows the address, so the list of accounts cannot be browsed. |
| `SMTP_URL`         | *(unset)*                  | Outgoing mail, for password reset links and share invitations: `smtp://user:pass@host:587` (STARTTLS when offered) or `smtps://...:465`. Unset, the server sends no mail and an admin's temporary password stays the only way back into a local account. |
| `SMTP_FROM`        | *(required with `SMTP_URL`)* | The From header: `Notes <notes@example.com>` or a bare address. |
| `APP_URL`          | *(required with `SMTP_URL`)* | The client's public address, which links in mail point at. |
| `AUDIT_RETENTION_DAYS` | `180`                  | Days the [audit log](../features/accounts.md#audit-log) keeps an entry. |
| `UPDATE_CHECK`     | `on`                       | Asks GitHub twice a day for the newest release, so admins are told when there is one (a dot on their avatar, a line in the account menu, a banner in the overview). One request to `api.github.com`, through the same outbound boundary as link previews; `off` makes none. |
| `UPDATE_CHECK_REPO`| `TatuArvela/manifesto`     | Whose releases the check reads, for a fork that publishes its own. |
| `METRICS_PORT`     | *(unset)*                  | Serves `/metrics` on a port of its own, and never on the public one. See [Metrics](#metrics). |
| `METRICS_HOST`     | `127.0.0.1`                | Where the `METRICS_PORT` listener binds; `0.0.0.0` for a scraper in another container. |
| `METRICS_TOKEN`    | *(unset)*                  | Required on the public port to turn metrics on; optional on `METRICS_PORT`. |
| `CLIENT_DIR`       | `/app/public` in the image, else unset | A built client to serve at the site root beside the API. See [One container](#one-container). |
| `WEBHOOKS`         | `public`                   | Whether users may add [webhooks](../features/webhooks.md), and where they may point: `public` addresses only, `private` to also reach the local network (a Home Assistant or n8n beside the server), or `off`. |
| `LINK_PREVIEWS`    | `on`                       | Fetch linked pages to fill in [link previews](../features/link-previews.md). The server then makes outbound HTTP(S) requests to public addresses only. Set `off` where it has no internet access or should make no outbound requests; cards then stay plain. |

Both `STORAGE_DRIVER` and `AUTH_PROVIDER` are validated at boot. An unknown value fails fast with a clear error.

### Secrets from files

Each secret can be given as a file instead, the way Docker and Kubernetes mount secrets:
`DATABASE_URL_FILE`, `OIDC_CLIENT_ID_FILE`, `OIDC_CLIENT_SECRET_FILE`, `SMTP_URL_FILE`,
`METRICS_TOKEN_FILE` and `INITIAL_ADMIN_PASSWORD_FILE` name a file whose contents are the value (a
trailing newline is dropped). Setting both a variable and its `_FILE` stops the server at boot.

```yaml
services:
  manifesto:
    environment:
      STORAGE_DRIVER: postgres
      DATABASE_URL_FILE: /run/secrets/database_url
    secrets: [database_url]
secrets:
  database_url:
    file: ./database_url.txt
```

### First sign-in

With local sign-in on (`AUTH_PROVIDER=local` or `both`), a new server creates an `admin` account and prints its temporary password to
standard error on boot, regardless of `LOG_LEVEL`:

```bash
docker compose logs manifesto-server | grep temporaryPassword
```

Sign in as `admin` with that password and choose your own. Until you do, each restart prints a new one.
See [The initial admin](../features/accounts.md#the-initial-admin). With `AUTH_PROVIDER=oidc`, the first
person to sign in through the identity provider is the admin instead.

### Locked out

When no admin can sign in (the last one lost their password, or their authenticator and recovery codes,
or the identity provider no longer knows them), run the admin CLI inside the container. It works on the
database directly, with the server's own environment, and needs nothing from the running server:

```bash
docker exec manifesto-server node dist/cli.js list-admins
docker exec manifesto-server node dist/cli.js reset-password admin    # prints a temporary password
docker exec manifesto-server node dist/cli.js make-admin alice
docker exec manifesto-server node dist/cli.js create-admin rescue     # a new local admin
```

`reset-password` also ends the account's sessions and API tokens and turns off its two-factor sign-in,
as an admin's reset does. Each command is recorded in the audit log. A socket the running server
already holds for an ended session stays open until it reconnects; restart the server to close it at
once. Outside Docker, run `node dist/cli.js` from `packages/server` with the same environment.

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
| `OIDC_GROUPS_CLAIM`         | The claim holding the user's groups (default `groups`). Read from the ID token, or from userinfo when the token leaves it out. A list, or one group as a string. |
| `OIDC_USER_GROUP`           | Optional. Only members may sign in; anyone else is sent back to the sign-in screen with a message. |
| `OIDC_ADMIN_GROUP`          | Optional. Members are admins and non-members are not, decided again at every sign-in, so removing someone from the group at the identity provider takes admin away at their next sign-in. The last admin is never demoted. Leave unset to grant admin by hand. |
| `OIDC_AUTO_REGISTER`        | `on` (default) creates an account the first time someone signs in. `off` lets in only identities that already have one, and sends anyone else back with a message. |

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

### Scheduled backups

The server can take them itself. Set `BACKUP_INTERVAL_HOURS` (say `24`) and it backs up the SQLite
database with SQLite's online backup API, the same consistent, WAL-inclusive copy as `.backup`, into
`BACKUP_DIR` (default `$DATA_DIR/backups`) as `manifesto-YYYYMMDD-HHMMSS.db`, keeping the newest
`BACKUP_KEEP` (default 7). The disk it takes levels off at about `BACKUP_KEEP` times the database, and
the database includes the images.

Each run guards the disk:

- **Restarts do not add copies.** A run also happens at startup, but it is skipped while the newest
  backup is younger than 90% of the interval, so a restart, or a server stuck restarting, does not copy
  the database each time.
- **Half-written copies are cleared.** Each copy is written under a `.partial` name and renamed when
  whole, so a crash never leaves a file that looks like a backup, and the next run deletes the
  `.partial` a crash left.
- **A full disk is refused.** A run that would leave less than 256 MB free after the copy (sized from
  the database and its WAL) does not start, and fails the job instead: the admin overview shows the
  error, and the `manifesto_job_last_run_failed{job="scheduled backup"}` metric turns to 1.

A backup on the same volume as the database survives a bad upgrade or a deleted note, not a lost disk:
copy `BACKUP_DIR` somewhere else too (it is plain files, so any file backup will do). Restoring is as
above.

| Variable | Default | |
|---|---|---|
| `BACKUP_INTERVAL_HOURS` | *(unset: off)* | Hours between backups. |
| `BACKUP_KEEP` | `7` | Backups kept; older ones are deleted. |
| `BACKUP_DIR` | `$DATA_DIR/backups` | Where they go. |

**The database is the whole backup.** `DATA_DIR` sites the SQLite file and
nothing else (`config.ts`), and images are kept in the database too (the
`attachments` table, see [Attachments](../features/attachments.md)) rather
than as files on disk, so there is no second thing to copy.

With `STORAGE_DRIVER=postgres` this section does not apply, scheduled backups
included (the server says so at boot if `BACKUP_INTERVAL_HOURS` is set): back up
with `pg_dump` or whatever the managed database offers, which is one of the
reasons to choose it.

## Metrics

`/api/health` answers "is it up". `GET /metrics` answers "is it well", in Prometheus's text format. It
is off by default: with neither variable below set, nothing serves it. Two ways to turn it on:

- **On a port of its own, `METRICS_PORT`** (say `9464`): a second listener serving `/metrics` and
  nothing else, while the public port never serves it. It binds to `127.0.0.1` unless `METRICS_HOST`
  says otherwise, so only the server's own host reaches it. In Docker, where the scraper usually runs in
  another container, set `METRICS_HOST=0.0.0.0` and simply do not publish the port: containers on the
  same network reach it, the internet does not, and no reverse proxy is needed. `METRICS_TOKEN` is
  optional here; set it too and the scraper has to send it.
- **On the public port, `METRICS_TOKEN`** alone: `/metrics` answers only a request with that bearer
  token. It sits outside `/api`, so a reverse proxy can also keep it off the internet.

A refused request gets a 404, the same as a path that does not exist.

```yaml
scrape_configs:
  - job_name: manifesto
    metrics_path: /metrics
    # Only if METRICS_TOKEN is set:
    # authorization:
    #   credentials: <METRICS_TOKEN>
    static_configs:
      # With METRICS_PORT=9464 and METRICS_HOST=0.0.0.0, not published:
      - targets: ["manifesto-server:9464"]
```

| Metric | |
|---|---|
| `manifesto_build_info{version}` | Always 1; the running version as a label |
| `manifesto_http_requests_total{method,status}` | API requests by method and status class (`2xx`...). No route label: note ids in paths would make a series per note |
| `manifesto_http_request_duration_seconds_sum{method,status}` | Time spent answering them; divide by the count for the mean |
| `manifesto_rate_limited_total{limiter}` | Requests a rate limit refused |
| `manifesto_app_sockets`, `manifesto_app_socket_users` | Open `/api/ws` sockets, and the accounts holding them |
| `manifesto_yjs_documents_open`, `manifesto_yjs_connections` | Collaborative editing |
| `manifesto_webhook_deliveries_total{result}` | Webhook deliveries, `delivered` or `failed` |
| `manifesto_job_last_run_failed{job}`, `..._timestamp_seconds`, `..._duration_seconds` | Each background job's last run; alert on a failure or a timestamp that stops moving |
| `process_uptime_seconds`, `process_resident_memory_bytes`, `nodejs_heap_used_bytes` | The process |

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

With the image serving the client itself ([One container](#one-container)), the proxy below only needs
to terminate HTTPS and pass everything to the server. The longer setup, where the proxy serves a client
bundle of its own and forwards `/api/*`, is for a client built separately (a rebranded one, say).

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
