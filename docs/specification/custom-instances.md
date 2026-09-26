# Custom Instances

Running Manifesto under your own name ("Corporate Notes", "Acme Memos",
whatever fits. This walks through a complete branded deployment end to end.

The single most useful fact up front: **the server carries no branding at all.**
Its API has no HTML, no icons, and no product name in any response. Rebranding
is entirely a client-side concern, so the server you deploy is the stock
published image, unmodified. The image does carry the stock client, which it
serves at the site root; to serve yours instead, mount your build into the
container and point `CLIENT_DIR` at it (see [One
container](server/deployment.md#one-container)), or unset `CLIENT_DIR` and host
the client yourself as below.

## Which path

| | Build from source | Edit a release bundle |
|---|---|---|
| Operating mode | open or connected | open only |
| Toolchain needed | Node + pnpm | none, a text editor |
| Brand assets live | in a folder outside the repo | in the unzipped bundle |
| Effort per upstream release | re-run one build command | redo the edits |

The mode is what decides this. Connected mode bakes the server URL into the
bundle *and* into its Content Security Policy, so an edited release zip stays at
`connect-src 'self'` and physically cannot reach a server no matter what else
you change. A team instance therefore builds from source, at which point the
branding is three more variables in a command you were already running.

Editing a release bundle is the right path for an open-mode instance: a
local-storage-only build dropped on an intranet share or a static host, with no
accounts and no sync.

## Walkthrough: a connected team instance

The scenario: Acme wants "Corporate Notes" at `notes.acme.internal`, backed by
their own server, with accounts from their existing identity provider.

Replacing the app's name is optional. A deployment that keeps "Manifesto" and
only says whose copy it is sets the instance and organisation instead
(`VITE_INSTANCE_NAME="Foo QA project" VITE_ORG_NAME="Acme Inc"
VITE_ORG_LOGO=~/acme-brand/acme.svg`), and users see "Manifesto · Foo QA
project" with Acme Inc's name and logo. The two combine; see
[Rebranding](client/deployment.md#rebranding) for where each appears.

### 1. Collect the brand assets

Create a folder anywhere outside the repository, such as `~/acme-brand/`. Include only
what you want to change; anything absent keeps the stock mark.

| File | Where it shows up |
|---|---|
| `logo.svg` | the mark beside the title in the header |
| `favicon.svg` | the browser tab |
| `icon-1024.png` | the installed PWA and the iOS home screen |

`logo.svg` is rendered at 24×24 and inverted in dark mode (`dark:invert`), so a
dark, single-colour mark on a transparent background works best.

### 2. Run the server

Stock image, no rebuild. Pin the tag to the release you intend to run.

```yaml
services:
  notes-server:
    image: ghcr.io/tatuarvela/manifesto-server:X.Y.Z
    ports: ["3001:3001"]
    volumes: [notes-data:/app/data]
    environment:
      CORS_ORIGINS: https://notes.acme.internal   # where the client will live
      REGISTRATION_ENABLED: "false"               # accounts provisioned via the IdP
      AUTH_PROVIDER: oidc
      OIDC_ISSUER: https://idp.acme.internal
      OIDC_CLIENT_ID: corporate-notes
      OIDC_CLIENT_SECRET: ...
      OIDC_REDIRECT_URI: https://notes-api.acme.internal/api/auth/callback
      OIDC_POST_LOGIN_REDIRECT: https://notes.acme.internal
volumes: { notes-data: }
```

`CORS_ORIGINS` must list the client's origin or the browser blocks every
request, unless you put both behind
[one reverse proxy on one origin](server/deployment.md#single-origin-behind-one-reverse-proxy),
where nothing is cross-origin and the variable never applies. Drop the published
`3001` port once a proxy is in front: see
[Do not publish the server port](server/deployment.md#do-not-publish-the-server-port).
See [Server Deployment](server/deployment.md) for the full variable list,
Postgres setup, and reverse-proxy notes.

### 3. Build the client

Branding and backend in one command:

```bash
git clone https://github.com/TatuArvela/manifesto && cd manifesto
pnpm install
VITE_APP_NAME="Corporate Notes" \
VITE_APP_DESCRIPTION="Shared notes for the Acme team." \
VITE_APP_ICONS_DIR=~/acme-brand \
VITE_MANIFESTO_SERVER=https://notes-api.acme.internal \
  pnpm --filter @manifesto/client build
```

Hosting under a subpath rather than a domain root? Add
`MANIFESTO_BASE_URL=/notes/`. The router, the logo, the web manifest and the
service worker all derive their paths from it.

### 4. Serve the output

`packages/client/dist/` is a static site. Any host works, as long as unknown
paths fall back to `index.html`: Manifesto uses real URL paths, so `/archived`
and `/tags/work` must reach the SPA. `dist/404.html` covers GitHub Pages out of
the box; see [Client Deployment](client/deployment.md#routing-for-static-hosts)
for nginx, Caddy, Netlify and Vercel.

### 5. Verify

```bash
curl -s https://notes-api.acme.internal/api/health          # server up, version
curl -s https://notes.acme.internal/ | grep -o '<title>.*'  # Corporate Notes
curl -s https://notes.acme.internal/manifest.webmanifest    # name + description
```

Then load the page: the header should show your mark and name, and the login
screen should have "Corporate Notes" as its heading. Open-mode exports download as
`corporate-notes-export-YYYY-MM-DD.zip`; a server names its download after the account.

## Walkthrough: rebranding a release bundle

No toolchain. The app reads its name from the HTML at startup and its icons are
plain files at fixed paths, so both are editable after the fact. The bundle
ships in open mode; the same file also carries the server it talks to, so a
rebranded connected instance is this walkthrough plus
[two more lines](client/deployment.md#pointing-a-release-bundle-at-a-server).

```bash
unzip manifesto-client-vX.Y.Z.zip && cd dist
sed -i '' 's/Manifesto/Corporate Notes/g' index.html 404.html manifest.webmanifest
cp ~/acme-brand/*.svg ~/acme-brand/icon-1024.png .
```

That covers `<title>`, `<meta name="application-name">`,
`<meta name="description">`, and the manifest's `name` / `short_name` /
`description`. `404.html` is a copy of `index.html` for SPA fallback, so it
needs the same treatment.

**Leave the JS bundle alone.** It is minified, and the `manifesto:` prefixes
inside it are `localStorage` keys, and rewriting those would orphan every note
already saved in a browser.

## What is parametrised

| Surface | Set by |
|---|---|
| Window title, header, login screen, crash screen, PWA name | `VITE_APP_NAME` |
| The app's mark in the header, login screen and welcome dialog | `VITE_APP_LOGO` (or `logo.svg` in `VITE_APP_ICONS_DIR`) |
| Which copy this is, beside the name in the header and tab, on the login screen, in About and the authenticator entry | `VITE_INSTANCE_NAME` |
| The instance's logo, in About and (with the next row) the header | `VITE_INSTANCE_LOGO` |
| The instance's logo and name in the header instead of the app's, and its logo as the tab icon | `VITE_HEADER_BRAND=instance` |
| The window title as the instance's name alone, without " · Manifesto" | `VITE_TITLE_APP_NAME=off` |
| Any logo's dark-theme version | `VITE_APP_LOGO_DARK`, `VITE_INSTANCE_LOGO_DARK`, `VITE_ORG_LOGO_DARK` |
| The owning organisation's name and logo, on the login screen and in About | `VITE_ORG_NAME`, `VITE_ORG_LOGO` |
| Export and crash-backup filenames | derived from `VITE_APP_NAME` |
| PWA manifest description, HTML meta description | `VITE_APP_DESCRIPTION` |
| Header mark, favicon, PWA icon | `VITE_APP_ICONS_DIR` |
| First-visit welcome dialog, on or off | `VITE_APP_WELCOME`, or the `welcome-dialog` meta tag in a release bundle |

No translated string spells the name out. The message catalogues carry an
`{appName}` placeholder that is filled at render time, so a rebrand reaches
every locale at once. A test fails if a catalogue ever hard-codes it.

A placeholder cannot be inflected, since a translation cannot know how another
name declines, so every message is phrased to leave it in its base form: the
welcome dialog says "Tämä on {appName}", not "Tervetuloa {appName}on". One
wording therefore serves every deployment name.

Not parametrised, both one-line source edits:

- **Theme colour** `#2563eb`, in `packages/client/index.html`
  (`<meta name="theme-color">`) and `packages/client/public/manifest.webmanifest`
  (`theme_color`).
- **The repository link** in Settings → About, in
  `packages/client/src/components/SettingsDialog.tsx`.

Deliberately left alone: the `manifesto:` `localStorage` keys and the
`@manifesto/*` workspace package names. They are internal identifiers, and
changing the storage keys would orphan existing notes in users' browsers.

## Tracking upstream

Brand assets stay outside the repository precisely so that upgrading is a
fast-forward, not a merge conflict:

```bash
git pull && pnpm install
VITE_APP_NAME="Corporate Notes" ... pnpm --filter @manifesto/client build
```

Keeping the environment variables in `packages/client/.env` (gitignored, see
`.env.example`) rather than the command line makes that a plain `pnpm build`.
The server is a tag bump in your compose file.

## See also

- [Operating Modes](operating-modes.md): open vs connected, storage and auth options
- [Client Deployment](client/deployment.md): static hosting, PWA, build-time configuration
- [Server Deployment](server/deployment.md): Docker, environment, reverse proxy, OIDC, Postgres
