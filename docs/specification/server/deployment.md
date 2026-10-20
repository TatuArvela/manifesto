# Server Deployment

The server is a JSON and WebSocket API. The published image also contains a built client, and serves
it at the site root (`CLIENT_DIR`). Thus, one container is a full connected-mode deployment on one
origin. See [One container](#one-container). The API itself has no branding, and the client in the
image is the usual build. For a rebranded deployment, set `CLIENT_DIR` to your own build, or host the
client separately. See [Custom Instances](../custom-instances.md).

## Running Directly

The image is the supported way to run a server, but a clone runs the same code. It needs Node 24 (the
version in `.tool-versions` and in the image), and pnpm through corepack (`corepack enable`).
`better-sqlite3` and `argon2` are native modules. pnpm gets prebuilt binaries for common platforms.
Where there are none, it builds them. That needs Python, `make` and a C++ compiler.

```bash
git clone https://github.com/TatuArvela/manifesto.git && cd manifesto
pnpm install
pnpm --filter @manifesto/server build
VITE_MANIFESTO_SERVER=/ pnpm --filter @manifesto/client build   # only to serve the client too
```

The server reads its settings only from the environment (see
[Environment Variables](#environment-variables)). Nothing loads a `.env` file automatically. Thus, give
one to Node. Copy `packages/server/.env.example` to `packages/server/.env`, and set a minimum of:

```bash
DATA_DIR=/var/lib/manifesto          # the SQLite database; relative paths are from the working directory
CLIENT_DIR=/path/to/manifesto/packages/client/dist   # serve the client built above, as the image does
```

Then start it from `packages/server`:

```bash
cd packages/server
node --env-file=.env dist/index.js
```

The first start prints the temporary password of the admin (see [First sign-in](#first-sign-in)). The
admin CLI runs from the same directory: `node --env-file=.env dist/cli.js list-admins`. The build reads
its version from the git history. Thus, a full clone reports the exact build (`0.5.0+14.bf5a6dd`), and
a shallow clone reports only its commit (`0.5.0+bf5a6dd`).

To keep it running, use a systemd unit similar to this one, with a `manifesto` user that owns
`DATA_DIR`:

```ini
[Unit]
Description=Manifesto server
After=network.target

[Service]
User=manifesto
WorkingDirectory=/path/to/manifesto/packages/server
ExecStart=/usr/bin/node --env-file=.env dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

To update, run `git pull`, run the install and build commands again, and restart. Put HTTPS in front of
it, as for the image. See [Reverse Proxy](#reverse-proxy).

## Docker

### One container

The image also serves the client. Open `http://localhost:3001/` and sign in. The client in it is built
with its server set to `/`. Thus, it connects to the container that it came from, on the same origin.
You need no `CORS_ORIGINS` and no `VITE_MANIFESTO_SERVER`, and the `connect-src 'self'` of the client
already reaches the API and both sockets. The server:

- Adds the headers that a `<meta>` CSP cannot contain (`frame-ancestors`, `X-Frame-Options`).
- Caches hashed assets permanently.
- Revalidates the page and the service worker.
- Answers all client routes with the page.

Put HTTPS in front of it, and the deployment is complete.

`CLIENT_DIR` (set to `/app/public` in the image) turns this on. To serve a different build (a
rebranded build, mounted into the container), point it to that build. To run only the API behind a
client hosted in a different place, unset it. Open mode and GitHub Pages stay the static client, as
before.

### What is in an image

Each published image has an SBOM (the packages inside it) and a build provenance attestation (the
repository, commit and workflow that built it). Both are attached in the registry:

```bash
docker buildx imagetools inspect ghcr.io/tatuarvela/manifesto-server:X.Y.Z --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/tatuarvela/manifesto-server:X.Y.Z --format '{{ json .Provenance }}'
```

Images from releases before we added this have neither.

Release images are also signed with [cosign](https://docs.sigstore.dev/cosign/), keyless. The
signature names the workflow that built the image, not a key. Thus, there is no key to publish or
lose. To make sure that an image came from the release workflow of this repository:

```bash
cosign verify ghcr.io/tatuarvela/manifesto-server:X.Y.Z \
  --certificate-identity https://github.com/TatuArvela/manifesto/.github/workflows/image-publish.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

An admission policy (Kyverno, the Sigstore policy controller) checks the same two values. The
signature is on the multi-arch index, which is what a tag resolves to. Images from releases before we
added signatures are not signed.

### Compose files

The root of the repository has two. release-please keeps them at the current release, together with
the packages:

- [`compose.yaml`](../../../compose.yaml): the one container, SQLite on a volume, daily backups on.
- [`compose.postgres.yaml`](../../../compose.postgres.yaml): the same with a Postgres, with
  `POSTGRES_PASSWORD` from the environment or a `.env` file.

Download one, uncomment the lines that apply (this page documents each variable below), and run
`docker compose up -d`. The sections that follow tell about more (HTTPS, a proxy, OIDC).

### Releases

Each release publishes a multi-arch image. Thus, you do not have to build anything. Pin the tag to
the release that you want to run:

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

The data stays after container restarts, because of the volume mount.

The published port is to try the server directly. Behind a reverse proxy, remove it. See
[Do not publish the server port](#do-not-publish-the-server-port).

### Building the image yourself

To work on the server, or to run a commit that no release contains, build the image yourself. The
Dockerfile is `packages/server/Dockerfile`. Build with the root of the repository as the build
context, so that the workspace manifests are available:

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

`/api/v1/health` reports the version of the server. The build context has no `.git`. Thus, an image
built in this way reports the release number from `package.json`, also when you build it from a later
commit. To report the exact build, resolve the version on the host, and give it as a build arg:

```bash
docker build -f packages/server/Dockerfile \
  --build-arg MANIFESTO_VERSION="$(node packages/build-version/src/cli.ts)" .
```

With Compose, list `MANIFESTO_VERSION` under `build.args`, and export it before
`docker compose up --build`.

## Environment Variables

See `packages/server/.env.example` for the full list and the defaults. The features that a host can
switch off have their own table, under [Turning features off](#turning-features-off).

| Variable           | Default                    | Description                              |
|--------------------|----------------------------|------------------------------------------|
| `PORT`             | `3001`                     | Server port                              |
| `STORAGE_DRIVER`   | `sqlite`                   | Storage driver: `sqlite` or `postgres`.  |
| `AUTH_PROVIDER`    | `local`                    | Auth provider: `local`, `oidc`, or `both` together (see below). |
| `PASSWORD_FORM`    | `shown`                    | With `AUTH_PROVIDER=both`: `shown` puts the password form under the single sign-on button. `collapsed` puts it behind a "Sign in with a password instead" link. Use `collapsed` for servers where SSO is the usual way in, and local accounts are the spare key of the admin. |
| `DATA_DIR`         | `./data`                   | The directory for the SQLite database    |
| `MANIFESTO_DB`     | `${DATA_DIR}/manifesto.db` | Sets the SQLite path explicitly          |
| `DATABASE_URL`     | _(required for postgres)_  | Postgres connection string               |
| `DATA_ENCRYPTION_KEY` | *(a key file)*          | The server key: 32 random bytes in base64 or hex (`openssl rand -base64 32`). See [The server key](#the-server-key). |
| `DATA_ENCRYPTION_KEY_PREVIOUS` | *(unset)*      | The previous key, while the server moves the values of a replaced key. |
| `DATA_KEY_FILE`    | `${DATA_DIR}/server.key`   | Where the server keeps its key when `DATA_ENCRYPTION_KEY` is not set. |
| `CORS_ORIGINS`     | `http://localhost:5173`    | Permitted client origins, separated by commas |
| `SESSION_TTL_DAYS` | `30`                       | The session inactivity timeout in days   |
| `SESSION_ABSOLUTE_TTL_DAYS` | `90`              | The hard session lifetime in days, from the login. A session in constant use still ends here. Thus, a stolen token cannot stay valid forever. |
| `LOG_LEVEL`        | `info`                     | One of debug / info / warn / error       |
| `ARGON2_MEMORY_KIB` | `19456`                   | argon2id memory cost (only local auth)   |
| `ARGON2_TIME_COST`  | `2`                       | argon2id time cost (only local auth)     |
| `ARGON2_PARALLELISM` | `1`                      | argon2id parallelism (only local auth)   |
| `REGISTRATION_ENABLED` | `true`                  | Permits public POST `/api/v1/auth/register`. Set `false` when only an admin must make accounts, from the Users view. A registration never makes a person an admin. When it is off, the login screen has no Create account tab. |
| `INITIAL_ADMIN_PASSWORD` | _(generated)_          | The temporary password for the initial `admin` account, in place of a generated password that the server prints at start. 8 to 256 characters. The user must still change it at the first sign-in. Only local auth. See [The initial admin](../features/accounts.md#the-initial-admin). |
| `DEFAULT_PREFS`    | *(unset)*                  | The preferences of each new account, as one JSON object with the preference names of the client as keys: `{"theme":"dark","boardTexture":"dots","noteCorners":"rounded"}`. A key that the account never stored gets this value, in place of the default of the client. An account can change it, as all settings. A later change of this variable applies only to keys that an account does not have yet. If the client does not know a value, it uses its own default. [Preferences](../features/preferences.md#defaults-from-the-server) lists the names and values. The server refuses it at start if it is not a JSON object, or is larger than 16 KB. |
| `TRUST_PROXY`      | `false`                    | Uses `X-Forwarded-For` for rate limits by IP. Set `true` only behind a trusted reverse proxy that overwrites the header, and make sure that it does. The server trusts the value fully. The server throttles an IPv6 client on its /64, not on its address. It throttles an IPv4 client on its address. |
| `USER_LOOKUP`      | `exact`                    | How a person who [shares a note](../features/sharing-with-people.md) finds the other person. `exact` finds an account only by its full username or email address, and never shows the address. Thus, nobody can look through the list of accounts. `search` suggests accounts by username, display name or email while the person types, and shows the address. Select it only where all accounts can see all other accounts. With it, all persons who can sign in (with `REGISTRATION_ENABLED` on, all persons) can collect all addresses on the server. |
| `SMTP_URL`         | *(unset)*                  | Outgoing mail, for password reset links, sign-in links and share invitations: `smtp://user:pass@host:587` (STARTTLS when available) or `smtps://...:465`. If it is not set, the server sends no mail. Then a temporary password from an admin is the only way back into a local account. |
| `SMTP_FROM`        | *(required with `SMTP_URL`)* | The From header: `Notes <notes@example.com>`, or only an address. |
| `APP_URL`          | *(required with `SMTP_URL`)* | The public address of the client (its full URL, with its base path). Links in mail point to it. An [AI assistant that signs in](../features/mcp.md#signing-in-through-the-browser) goes to its consent page there. For that function, it is not necessary when the server serves the client itself (`CLIENT_DIR`). |
| `AUDIT_RETENTION_DAYS` | `180`                  | The number of days that the [audit log](../features/accounts.md#audit-log) keeps an entry. |
| `UPDATE_CHECK`     | `on`                       | Asks GitHub two times each day for the newest release. Thus, admins learn when there is one (a dot on the settings button, a line on the About page of Settings, a banner in the overview). It is one request to `api.github.com`, through the same outbound boundary as link previews. `off` makes no request. |
| `UPDATE_CHECK_REPO`| `TatuArvela/manifesto`     | The repository whose releases the check reads, for a fork that publishes its own releases. |
| `METRICS_PORT`     | *(unset)*                  | Serves `/metrics` on its own port, and never on the public port. See [Metrics](#metrics). |
| `METRICS_HOST`     | `127.0.0.1`                | Where the `METRICS_PORT` listener binds. Use `0.0.0.0` for a scraper in a different container. |
| `METRICS_TOKEN`    | *(unset)*                  | Necessary on the public port to turn metrics on. Optional on `METRICS_PORT`. |
| `CLIENT_DIR`       | `/app/public` in the image, else unset | A built client to serve at the site root, together with the API. See [One container](#one-container). |

The server validates `STORAGE_DRIVER` and `AUTH_PROVIDER` when it starts. An unknown value fails
immediately with a clear error.

### Turning features off

One variable switches each of these features, from one registry in the server
(`packages/server/src/features.ts`). A feature that is off is not there:

- All of its routes send the same 404 as a route that the server never had, before the server asks
  for a sign-in.
- `GET /api/v1/capabilities` reports it as off. Thus, the client hides it (its menu items, settings
  pages and dialog sections).
- Open mode, with no server, does not change.

When a feature is off, the way out of it always stays. A person can still remove a person or a team
from a note, leave a note, remove a passkey, turn off two-factor, and revoke a token. Thus, nobody
keeps something that they cannot undo. An account that already has a second factor must still give
it at each sign-in.

| Variable        | Default  | What it switches |
|-----------------|----------|------------------|
| `SHARING`       | `on`     | [Sharing a note with other accounts](../features/sharing-with-people.md): invitations, the search for people (`/api/v1/users`), and changes to what a person can do. When it is off, a note that is already shared stays shared. Its owner can still remove people from it, and they can still leave. |
| `TEAMS`         | `on`     | [Teams](../features/sharing-with-people.md#teams): the Teams page of the admin, single sign-on groups mirrored as teams, and sharing a note with a full team. It needs `SHARING`. When it is off, the sign-in does not update membership. A note that is already shared with a team stays shared, and the owner can still remove the team from it. |
| `PUBLIC_LINKS`  | `on`     | Lets owners publish a note through a [public link](../features/sharing.md#public-links), readable by all persons with the link, with an optional expiry, password and view limit. Set `off` where nothing can be readable without an account. Then all links, also existing links, send 404, and the menu item does not show. |
| `LINK_PREVIEWS` | `on`     | Gets linked pages to fill [link previews](../features/link-previews.md). The server then makes outbound HTTP(S) requests, only to public addresses. Set `off` where the server has no internet access, or must make no outbound requests. Then cards stay plain. |
| `CALENDAR`      | `on`     | The [reminders calendar feed](../features/reminders.md#calendar-feed), to which a calendar app subscribes through a secret address. When it is off, existing feeds send 404, and Settings offers no new feed token. |
| `API_TOKENS`    | `on`     | Personal API tokens for scripts and bots. When it is off, nobody can make one, and the server refuses existing tokens in all places, also on both sockets. MCP and calendar tokens follow `MCP` and `CALENDAR`. |
| `MCP`           | `on`     | The [MCP endpoint](../features/mcp.md) for AI assistants, `/api/v1/mcp`. It answers only a token that a user makes for it in Settings, or agrees to give to an assistant that signs in through the browser. Thus, on does not open anything by itself. The sign-in is available when the server knows the location of its client (`APP_URL` or `CLIENT_DIR`). `off` removes the endpoint and the sign-in, refuses existing MCP tokens, and makes no more. |
| `WEBHOOKS`      | `public` | If users can add [webhooks](../features/webhooks.md), and where they can point: only `public` addresses; `private` to also reach the local network (a Home Assistant or n8n near the server); or `off`, which also stops all deliveries. |
| `PASSKEYS`      | `on`     | Adding [passkeys](../features/accounts.md#signing-in-with-a-passkey), and signing in with only a passkey. When it is off, nobody can add one or sign in with only a passkey. But the server still asks for an existing passkey as a second factor, and the user can remove it. |
| `MAGIC_LINKS`   | `on`     | [Signing in from a link](../features/accounts.md#signing-in-with-a-link) sent to the address of a local account, with no password. It needs `SMTP_URL`, and is absent without it. When it is off, the server sends no link, and refuses links that it already sent. An account with a second factor must give it in both cases. Set `off` where a mailbox alone must not open an account. |
| `WEB_PUSH`      | `on`     | [Push reminders](../features/reminders.md#push-from-the-server): when a reminder becomes due and no open app fires it, the server sends it as a push message. Thus, an installed app gets it while it is closed. The server then makes outbound HTTPS requests to the push services of the browsers (of Google, Apple and Mozilla). The requests contain the title and the first words of the note, encrypted to the browser, and go through the same boundary as link previews. No setup is necessary. The server makes the signing key on the first use, and keeps it in the database. Set `off` where the server must make no such requests. Then reminders arrive only while the app is open, or when the browser wakes it. |
| `TWO_FACTOR`    | `on`     | Turning on [two-factor sign-in](../features/accounts.md#two-factor-sign-in) with an authenticator app. When it is off, nobody can turn it on. But an account that has it must still give its code, and can turn it off. When `PASSKEYS` is also off, Settings has no two-factor page. |

A feature whose requirement is off is also off. When its own variable is not set, this is implied
(`SHARING=off` alone turns off teams). When its variable says `on` (`SHARING=off` with `TEAMS=on`), the
server does not start. It does not guess which value you meant.

### The server key

The browser encrypts notes, under keys that the server never has
([Encryption](../features/encryption.md)). The server must read some other values by itself, when
nobody is signed in: when a reminder is due, the signing secret of a webhook, the secret of an
authenticator app, the key that signs push messages, and the keys of each push subscription. The
server stores those under one **server key**, which is never in the database.

- Give it as `DATA_ENCRYPTION_KEY` (or `DATA_ENCRYPTION_KEY_FILE`): 32 random bytes in base64 or hex.
  `openssl rand -base64 32` makes one.
- Without it, the server makes a key on the first start, and writes it to `DATA_KEY_FILE`
  (`${DATA_DIR}/server.key` by default). Only the user of the server can read it. The log tells this.
- **Make a backup of the key separately from the database.** A copy of the database without the key
  cannot read those values. That is the purpose of the key. A copy of both can read them. The server
  shows a warning at each start while the key file is in the same directory as the SQLite database or
  its backups. To keep them separate, point `DATA_KEY_FILE` to a different place, or give the key
  through the environment.
- **If you lose the key**, you lose reminder times, webhooks, authenticator set-ups and push
  subscriptions. You can make all of them again. You lose no note.
- **To replace it**, set the new key as `DATA_ENCRYPTION_KEY` and the old key as
  `DATA_ENCRYPTION_KEY_PREVIOUS`, and restart. At start-up, the server writes all values again under
  the new key. The log tells when nothing is under the old key. Then you can remove
  `DATA_ENCRYPTION_KEY_PREVIOUS`. With a key file, put the new key in the file and the old key in
  `DATA_ENCRYPTION_KEY_PREVIOUS`.
- A server that ran before it had a key seals its stored values the first time that it starts with
  one.

### Secrets from files

You can give each secret as a file, as Docker and Kubernetes mount secrets. `DATABASE_URL_FILE`,
`OIDC_CLIENT_ID_FILE`, `OIDC_CLIENT_SECRET_FILE`, `SMTP_URL_FILE`, `METRICS_TOKEN_FILE`,
`INITIAL_ADMIN_PASSWORD_FILE`, `DATA_ENCRYPTION_KEY_FILE` and `DATA_ENCRYPTION_KEY_PREVIOUS_FILE` name
a file whose contents are the value (the server removes a newline at the end). If you set a variable
and its `_FILE` together, the server stops at start.

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

With local sign-in on (`AUTH_PROVIDER=local` or `both`), a new server makes an `admin` account and
prints its temporary password to standard error when it starts, whatever the `LOG_LEVEL`:

```bash
docker compose logs manifesto-server | grep temporaryPassword
```

Sign in as `admin` with that password, and select your own password. Until you do, each restart prints
a new password. See [The initial admin](../features/accounts.md#the-initial-admin). With
`AUTH_PROVIDER=oidc`, the first person who signs in through the identity provider is the admin.

### Locked out

When no admin can sign in (the last admin lost their password, or their authenticator and recovery
key, or the identity provider does not know them now), run the admin CLI inside the container. It
works directly on the database, with the environment of the server, and needs nothing from the
running server:

```bash
docker exec manifesto-server node dist/cli.js list-admins
docker exec manifesto-server node dist/cli.js reset-password admin    # prints a temporary password
docker exec manifesto-server node dist/cli.js make-admin alice
docker exec manifesto-server node dist/cli.js create-admin rescue     # a new local admin
```

`reset-password` also ends the sessions and API tokens of the account, and turns off its two-factor
sign-in and its passkeys, as a reset by an admin does. The audit log records each command. A socket
that the running server already has for an ended session stays open until it reconnects. To close it
immediately, restart the server. Outside Docker, run `node dist/cli.js` from `packages/server` with
the same environment.

### Local and single sign-on together

`AUTH_PROVIDER=both` offers both at the same time. The sign-in screen shows the single sign-on button,
then the password form (or a link to it, with `PASSWORD_FORM=collapsed`).

- Sessions are the same, whatever the sign-in method. The `users` table contains both types of
  account.
- Accounts from the identity provider sign in only through it. Local accounts, also the initial admin,
  sign in only with their password. Thus, you can still reach the server if the identity provider is
  down.
- Admins can create local accounts and give temporary passwords, as with `local`.
- `OIDC_*` is necessary, as for `oidc`.

### OIDC variables (when `AUTH_PROVIDER=oidc` or `both`)

All of these are necessary, and the server validates them when it starts. The server reads them only
when the OIDC provider is selected.

| Variable                    | Description                                                                 |
|-----------------------------|-----------------------------------------------------------------------------|
| `OIDC_ISSUER`               | Issuer URL (for OIDC discovery, for example `https://idp.example.com`)     |
| `OIDC_CLIENT_ID`            | The client ID registered with the IdP                                       |
| `OIDC_CLIENT_SECRET`        | The client secret registered with the IdP                                   |
| `OIDC_REDIRECT_URI`         | The callback URL of the server. It must end in `/api/v1/auth/callback`      |
| `OIDC_POST_LOGIN_REDIRECT`  | The client-side URL to go to after a successful login (token in the fragment) |
| `OIDC_SCOPES`               | Scopes separated by commas (default `openid,profile,email`)                 |
| `OIDC_GROUPS_CLAIM`         | The claim that contains the groups of the user (default `groups`). The server reads it from the ID token, or from userinfo when the token does not have it. A list, or one group as a string. |
| `OIDC_USER_GROUP`           | Optional. Only members can sign in. All other persons go back to the sign-in screen, with a message. |
| `OIDC_ADMIN_GROUP`          | Optional. Members are admins, and other persons are not. The server decides it again at each sign-in. Thus, if you remove a person from the group at the identity provider, they lose admin rights at their next sign-in. The server never demotes the last admin. To give admin rights manually, do not set it. |
| `OIDC_TEAM_GROUPS`          | Optional. Groups to mirror as [teams](../features/sharing-with-people.md#teams), separated by commas, or `*` for all groups. Each becomes a team the first time that a member signs in. Its members follow the group at each sign-in. If it is not set, no group becomes a team. Admins can still make teams manually. |
| `OIDC_AUTO_REGISTER`        | `on` (default) creates an account the first time that a person signs in. `off` lets in only identities that already have an account, and sends all other persons back with a message. |
| `OIDC_UNVERIFIED_EMAIL`     | `refuse` (default) stores the email address of an account only when the provider sends `email_verified: true`. `accept` also stores an address about which the provider says nothing. Use it for a provider that does not send the claim, and gives out only addresses that it controls. The server never stores an address marked `email_verified: false`. |

The login flow:

1. The client gets `GET /api/v1/capabilities`. It shows a "Continue with single sign-on" button when
   `auth.providers` includes `oidc`.
2. The user clicks the button, and goes to `<server>/api/v1/auth/login`. The server stores the PKCE
   state, and redirects to the authorization endpoint of the IdP.
3. After the user consents, the IdP redirects to `OIDC_REDIRECT_URI` with `code` and `state`.
4. The server verifies the state, exchanges the code (PKCE), and reads the ID-token claims. It makes
   the user just in time (by `(provider, sub)`), and makes a Manifesto session token.
5. The server redirects to `OIDC_POST_LOGIN_REDIRECT#token=<sessionToken>`.
6. The client reads the fragment on the first paint. It calls `GET /api/v1/auth/me` with the bearer
   token to get the user record, fills its auth signals, and removes the fragment from the address
   bar. It does this only in the tab that started the sign-in. Step 1 leaves a mark in the
   `sessionStorage` of that tab, good for 15 minutes and for one use. A `#token=` in a link that a
   person got is removed and ignored, because it would sign them in to the account of the sender.

The client then sends the session token as `Authorization: Bearer <token>` to the remaining API, the
same as with the local provider. Logout (`POST /api/v1/auth/logout`) cancels the local session. It does
not do a logout at the IdP (version 1 does not implement RP-initiated logout).

Set `OIDC_POST_LOGIN_REDIRECT` to the URL of the deployed client (for example
`https://notes.example.com/`). The client app handles the `#token=...` fragment automatically. Thus,
the client needs no special route.

#### Worked example: Authentik

```text
OIDC_ISSUER=https://auth.example.com/application/o/manifesto/
OIDC_CLIENT_ID=manifesto
OIDC_CLIENT_SECRET=<from Authentik provider page>
OIDC_REDIRECT_URI=https://server.example.com/api/v1/auth/callback
OIDC_POST_LOGIN_REDIRECT=https://notes.example.com/auth-callback
OIDC_SCOPES=openid,profile,email
AUTH_PROVIDER=oidc
```

In Authentik, set the redirect URI of the application to exactly the same value as
`OIDC_REDIRECT_URI`. Other IdPs (Keycloak, Google, Okta, Auth0, Authelia) work in the same way. Only
`OIDC_ISSUER` is different.

## Postgres deployment

For larger deployments or scale-out deployments, set `STORAGE_DRIVER=postgres` and
`DATABASE_URL=...`. The server creates the schema at the first start, and updates it at each start
after that. See [Schema migrations](index.md#schema-migrations).

The connection is encrypted only if `DATABASE_URL` asks for it. Without an `sslmode`, the server
connects to Postgres without encryption. That is acceptable on the private network of the compose
file below, but not across other networks. For a database on a different host, add
`?sslmode=verify-full` (and `&sslrootcert=/path/to/ca.pem` for a certificate authority that the system
does not already trust).

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

The Yjs document state is in a `BYTEA` column on `notes`. For very high collaborative-editing
throughput, think about Hocuspocus persistence in Redis, with Postgres as the cold store. For usual
note workloads, the model with one table is sufficient.

## Backups

**Make a backup of the SQLite database with `.backup`, never with `cp`.**

- The driver opens each database with `journal_mode = WAL` (`storage/sqlite/database.ts`). With WAL, a
  committed transaction is durable when it reaches `manifesto.db-wal`.
- It moves into `manifesto.db` only at a checkpoint. Thus, a copy of only `manifesto.db` can be
  without notes that were saved days ago.
- This is important because nothing tells you about it. The copy is a valid database that opens and
  passes `integrity_check`. Nothing looks wrong until a person looks for a note that is not there.
- A copy of all three files (`.db`, `-wal`, `-shm`) from a running server is not better, because
  nothing keeps the three files still while you read them.

`.backup` consolidates the WAL, cannot catch a write that is half complete, and runs while the server
continues to serve. The image has no `sqlite3` binary, and runs as a user that is not root. Thus,
`docker exec` cannot do this. Run a temporary container against the volume:

```bash
docker run --rm \
  -v <project>_manifesto-data:/data \
  -v "$PWD":/out \
  alpine:3 sh -c '
    apk add --no-cache sqlite >/dev/null &&
    sqlite3 /data/manifesto.db ".backup /out/manifesto-backup.db" &&
    sqlite3 /out/manifesto-backup.db "pragma integrity_check"'
```

Mount `/data` **writable**. To open a WAL database, also only to read it, SQLite must touch the `-shm`
file. Thus, a `:ro` mount cannot open it. Check the integrity of the copy, not of the live database,
as above. You restore from that file, and that file can be truncated.

To restore, do these steps:

1. Stop the server.
2. Replace `manifesto.db` in the volume with the backup.
3. Delete each `-wal` and `-shm` file next to it.
4. Start the server.

### Scheduled backups

The server can make backups itself. Set `BACKUP_INTERVAL_HOURS` (for example `24`). The server then
makes a backup of the SQLite database with the online backup API of SQLite. This is the same
consistent copy, with the WAL, as `.backup`. It goes into `BACKUP_DIR` (default `$DATA_DIR/backups`)
as `manifesto-YYYYMMDD-HHMMSS.db`. The server keeps the newest `BACKUP_KEEP` (default 7). The disk
space becomes stable at approximately `BACKUP_KEEP` times the database. The database includes the
images.

A backup contains all that the database contains: each note, password hash and secret. The server
writes each file readable only by its own user (`0600`). A `BACKUP_DIR` that the server creates has
`0700`. A directory that already exists keeps its access. Thus, check a directory that you made
yourself, especially on a volume that other accounts can reach.

Each run protects the disk:

- **Restarts do not add copies.** A run also occurs at startup. But the server skips it while the
  newest backup is younger than 90% of the interval. Thus, a restart, or a server that restarts again
  and again, does not copy the database each time.
- **Half-written copies are cleared.** The server writes each copy under a `.partial` name, and renames
  it when it is complete. Thus, a crash never leaves a file that looks like a backup. The next run
  deletes the `.partial` file that a crash left.
- **A full disk is refused.** A run that would leave less than 256 MB free after the copy (calculated
  from the database and its WAL) does not start. The job fails. The admin overview shows the error,
  and the `manifesto_job_last_run_failed{job="scheduled backup"}` metric becomes 1.

A backup on the same volume as the database protects against a bad upgrade or a deleted note, not
against a lost disk. Thus, also copy `BACKUP_DIR` to a different place (it is plain files, so all file
backups work). To restore, do the steps above.

| Variable | Default | |
|---|---|---|
| `BACKUP_INTERVAL_HOURS` | *(unset: off)* | The hours between backups. |
| `BACKUP_KEEP` | `7` | The number of backups to keep. The server deletes older backups. |
| `BACKUP_DIR` | `$DATA_DIR/backups` | Where they go. |

**The database is the full backup.** `DATA_DIR` sets only the location of the SQLite file
(`config.ts`). The database also contains the images (the `attachments` table, see
[Attachments](../features/attachments.md)), not files on disk. Thus, there is nothing else to copy.

With `STORAGE_DRIVER=postgres`, this section does not apply, also not the scheduled backups (if
`BACKUP_INTERVAL_HOURS` is set, the server tells this at start). Make backups with `pg_dump`, or with
the tools of the managed database. That is one of the reasons to select Postgres.

## Metrics

`/api/v1/health` answers "is it up". `GET /metrics` answers "is it well", in the text format of
Prometheus. It is off by default. When neither variable below is set, nothing serves it. There are two
ways to turn it on:

- **On its own port, `METRICS_PORT`** (for example `9464`): a second listener that serves only
  `/metrics`. The public port never serves it.
  - It binds to `127.0.0.1` unless `METRICS_HOST` gives a different value. Thus, only the host of the
    server reaches it.
  - In Docker, the scraper usually runs in a different container. Set `METRICS_HOST=0.0.0.0`, and do
    not publish the port. Containers on the same network reach it, and the internet does not. No
    reverse proxy is necessary.
  - `METRICS_TOKEN` is optional here. If you also set it, the scraper must send it.
- **On the public port, `METRICS_TOKEN`** alone: `/metrics` answers only a request with that bearer
  token. It is outside `/api`. Thus, a reverse proxy can also keep it off the internet.

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
| `manifesto_build_info{version}` | Always 1. The running version is a label |
| `manifesto_http_requests_total{method,status}` | API requests by method and status class (`2xx`...). There is no route label, because note ids in paths would make one series for each note |
| `manifesto_http_request_duration_seconds_sum{method,status}` | The time to answer them. Divide by the count for the mean |
| `manifesto_rate_limited_total{limiter}` | The requests that a rate limit refused |
| `manifesto_app_sockets`, `manifesto_app_socket_users` | Open `/api/v1/ws` sockets, and the accounts that have them |
| `manifesto_yjs_documents_open`, `manifesto_yjs_connections` | Collaborative editing |
| `manifesto_webhook_deliveries_total{result}` | Webhook deliveries, `delivered` or `failed` |
| `manifesto_job_last_run_failed{job}`, `..._timestamp_seconds`, `..._duration_seconds` | The last run of each background job. Make an alert on a failure, or on a timestamp that stops |
| `process_uptime_seconds`, `process_resident_memory_bytes`, `nodejs_heap_used_bytes` | The process |

## Reverse Proxy

Run the server behind a reverse proxy that terminates HTTPS. It must pass WebSocket upgrades through
for `/api/v1/ws` (application events) and `/api/v1/yjs` (collaborative editing). Most proxies do that
automatically for a proxied route. Thus, the two rarely need their own blocks.

It is easy to get the two items below wrong, and nothing else reports them. The
[setup checks](../features/accounts.md#setup-checks) in the admin overview look for both from the
request of the admin, and also check HTTPS, `APP_URL`, backups and mail.

### `X-Forwarded-For` must be overwritten, not appended

With `TRUST_PROXY=true`, the server throttles by IP with the **leftmost** value of `X-Forwarded-For`.
That is correct for a proxy that *overwrites* the header. It is wrong for a proxy that *appends* to
it, because an appending proxy puts the value that the client sent in front of the address that it
saw. Set `TRUST_PROXY=true` only with a proxy that overwrites, and only when nothing can reach the
server except through it.

- **nginx**: `proxy_set_header X-Forwarded-For $remote_addr;`
  Do **not** use `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, which is the line
  that most nginx tutorials give. `$proxy_add_x_forwarded_for` is the incoming header plus
  `$remote_addr`. Thus, it appends, and the server then trusts a value that the client selected. On
  `/api/v1/auth/login`, this gives each attacker an unlimited budget of argon2 verifications.
- **Caddy**: `header_up X-Forwarded-For {http.request.remote.host}` inside `reverse_proxy`. Recent
  Caddy already replaces the header of an untrusted client, and does not append. But when you write
  it, the behavior is part of your configuration, not of the image tag that you pulled.
- **Traefik**: the address that the server sees comes from the `forwardedHeaders` trust configuration
  of the entrypoint. Set `trustedIPs` to the proxy in front of Traefik, or to nothing when Traefik is
  the edge.

If you are not sure, keep `TRUST_PROXY` at `false`. The cost is that all clients share one throttle
bucket. That is much better than one bucket for each forged header.

### Do not publish the server port

The compose examples above have `ports: ["3001:3001"]`. That is correct for a local trial, and wrong
when a proxy is in front of it. A published port with `TRUST_PROXY=true` makes the proxy optional,
not a chokepoint. All clients that can reach the host on 3001 can set their own `X-Forwarded-For`,
and the server believes it. Behind a proxy, the server must have no `ports`. The proxy must reach it
over the compose network, by service name.

### Single origin behind one reverse proxy

When the image serves the client itself ([One container](#one-container)), the proxy below must only
terminate HTTPS and pass everything to the server. The longer setup, where the proxy serves its own
client bundle and forwards `/api/v1/*`, is for a separately built client (for example, a rebranded
client).

To serve the client bundle and proxy `/api/v1/*` from **one** origin is the recommended shape for a
deployment on one machine. It removes CORS fully: no preflights, no `CORS_ORIGINS` list to update
after a rename, one certificate, one DNS record, and no published server port. Nothing in the app
prevents it, also not the two WebSockets.

`CORS_ORIGINS` then does not apply, because no browser request is cross-origin. Its
`http://localhost:5173` default does no harm. This is useful to know, because an operator first
suspects a missing `CORS_ORIGINS` when something breaks. On a single origin, it is never the cause.

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
    # through on its own, so /api/v1/ws and /api/v1/yjs need no separate block.
    handle /api/v1/* {
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

We learned two details in this configuration from failures:

- The `handle` blocks of Caddy are mutually exclusive. Thus, a `header` block *inside* the last block
  does not apply to what the earlier blocks serve. The JS bundle, the fonts and all API responses then
  go out with no `nosniff`, but the configuration looks correct.
- The `Cache-Control` split keeps the PWA updating. If you cache the shell and `sw.js` without
  revalidation, the browser never asks for the new service worker again. Then the self-update path in
  [Client Deployment](../client/deployment.md#pwa) stops silently.

The split-origin examples in other parts of this document are still correct when the client is in a
place where the server is not, for example a CDN or GitHub Pages. Those need `CORS_ORIGINS` set to the
origin of the client.
