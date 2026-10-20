# Custom Instances

You can run Manifesto with your own name ("Corporate Notes", "Acme Memos", or a different name). This
page tells how to make a full branded deployment, from start to end.

The most important fact first: **the server has no branding.** Its API has no HTML, no icons, and no
product name in a response. Rebranding is only a client-side task. Thus, the server that you deploy
is the usual published image, with no changes. The image contains the usual client, and serves it at
the site root. To serve your client in its place, mount your build into the container and set
`CLIENT_DIR` to it (see [One container](server/deployment.md#one-container)). Or, do not set
`CLIENT_DIR`, and host the client yourself as below.

## Which path

| | Build from source | Edit a release bundle |
|---|---|---|
| Operating mode | open or connected | open only |
| Toolchain needed | Node and pnpm | none, only a text editor |
| Location of the brand assets | a folder outside the repository | the unzipped bundle |
| Work for each upstream release | run one build command again | do the edits again |

The mode decides the path. Connected mode puts the server URL into the bundle *and* into its Content
Security Policy. Thus, an edited release zip stays at `connect-src 'self'`, and it cannot connect to
a server, whatever other changes you make. Thus, a team instance builds from source. Then the
branding is only three more variables in a command that you already run.

To edit a release bundle is the correct path for an open-mode instance: a build that uses only local
storage, on an intranet share or a static host, with no accounts and no sync.

## Walkthrough: a connected team instance

The scenario: Acme wants "Corporate Notes" at `notes.acme.internal`, with their own server, and with
accounts from their existing identity provider.

It is optional to replace the name of the app. A deployment can keep "Manifesto" and only tell whose
copy it is. It then sets the instance and the organization
(`VITE_INSTANCE_NAME="Foo QA project" VITE_ORG_NAME="Acme Inc"
VITE_ORG_LOGO=~/acme-brand/acme.svg`). Users see "Manifesto · Foo QA project", with the name and logo
of Acme Inc. You can use the two methods together. See
[Rebranding](client/deployment.md#rebranding) for where each one shows.

### 1. Collect the brand assets

Make a folder outside the repository, for example `~/acme-brand/`. Put in it only the files that you
want to change. If a file is not there, the usual mark stays.

| File | Where it shows |
|---|---|
| `logo.svg` | the mark adjacent to the title in the header |
| `favicon.svg` | the browser tab |
| `icon-1024.png` | the installed PWA and the iOS home screen |

The app renders `logo.svg` at 24×24, and inverts it in dark mode (`dark:invert`). Thus, a dark mark
with one color on a transparent background is best.

### 2. Run the server

Use the usual image. Do not build it again. Pin the tag to the release that you want to run.

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
      OIDC_REDIRECT_URI: https://notes-api.acme.internal/api/v1/auth/callback
      OIDC_POST_LOGIN_REDIRECT: https://notes.acme.internal
volumes: { notes-data: }
```

`CORS_ORIGINS` must list the origin of the client. If not, the browser blocks all requests. The
exception is when you put both behind
[one reverse proxy on one origin](server/deployment.md#single-origin-behind-one-reverse-proxy).
Then nothing is cross-origin, and the variable does not apply. When a proxy is in front, remove the
published `3001` port. See
[Do not publish the server port](server/deployment.md#do-not-publish-the-server-port). See
[Server Deployment](server/deployment.md) for the full list of variables, the Postgres setup, and
the notes about the reverse proxy.

### 3. Build the client

Branding and backend are in one command:

```bash
git clone https://github.com/TatuArvela/manifesto && cd manifesto
pnpm install
VITE_APP_NAME="Corporate Notes" \
VITE_APP_DESCRIPTION="Shared notes for the Acme team." \
VITE_APP_ICONS_DIR=~/acme-brand \
VITE_MANIFESTO_SERVER=https://notes-api.acme.internal \
  pnpm --filter @manifesto/client build
```

To host under a subpath and not at the root of a domain, add `MANIFESTO_BASE_URL=/notes/`. The
router, the logo, the web manifest and the service worker all get their paths from it.

### 4. Serve the output

`packages/client/dist/` is a static site. All hosts work, if unknown paths go to `index.html`.
Manifesto uses real URL paths. Thus, `/archived` and `/tags/work` must reach the SPA.
`dist/404.html` does this on GitHub Pages without more work. See
[Client Deployment](client/deployment.md#routing-for-static-hosts) for nginx, Caddy, Netlify and
Vercel.

### 5. Verify

```bash
curl -s https://notes-api.acme.internal/api/v1/health          # server up, version
curl -s https://notes.acme.internal/ | grep -o '<title>.*'  # Corporate Notes
curl -s https://notes.acme.internal/manifest.webmanifest    # name + description
```

Then load the page. The header must show your mark and name. The heading of the login screen must
be "Corporate Notes". Open-mode exports download as `corporate-notes-export-YYYY-MM-DD.zip`. A server
gives its download the name of the account.

## Walkthrough: rebranding a release bundle

You do not need a toolchain. The app reads its name from the HTML when it starts, and its icons are
plain files at fixed paths. Thus, you can edit both after the build. The bundle is in open mode. The
same file also contains the server that it connects to. Thus, for a rebranded connected instance, do
this walkthrough and
[two more lines](client/deployment.md#pointing-a-release-bundle-at-a-server).

```bash
unzip manifesto-client-vX.Y.Z.zip && cd dist
sed -i '' 's/Manifesto/Corporate Notes/g' index.html 404.html manifest.webmanifest
cp ~/acme-brand/*.svg ~/acme-brand/icon-1024.png .
```

This changes `<title>`, `<meta name="application-name">`, `<meta name="description">`, and the
`name` / `short_name` / `description` of the manifest. `404.html` is a copy of `index.html` for the
SPA fallback. Thus, it needs the same change.

**Do not change the JS bundle.** It is minified. The `manifesto:` prefixes inside it are
`localStorage` keys. If you change them, the app loses all notes that are already saved in a
browser.

## What is parametrised

| Surface | Set by |
|---|---|
| Window title, header, login screen, crash screen, PWA name | `VITE_APP_NAME` |
| The mark of the app in the header, login and loading screens and welcome dialog | `VITE_APP_LOGO` (or `logo.svg` in `VITE_APP_ICONS_DIR`) |
| Which copy this is: adjacent to the name in the header and tab, on the login and loading screens, in About and in the authenticator entry | `VITE_INSTANCE_NAME` |
| The logo of the instance, in About and (with the next row) the header and loading screen | `VITE_INSTANCE_LOGO` |
| The logo and name of the instance in the header and on the loading screen in place of those of the app, and its logo as the tab icon | `VITE_HEADER_BRAND=instance` |
| The window title as only the name of the instance, without " · Manifesto" | `VITE_TITLE_APP_NAME=off` |
| The dark-theme version of each logo | `VITE_APP_LOGO_DARK`, `VITE_INSTANCE_LOGO_DARK`, `VITE_ORG_LOGO_DARK` |
| The name and logo of the owner organization, on the login screen and in About | `VITE_ORG_NAME`, `VITE_ORG_LOGO` |
| A link to the privacy notice of the deployment, on the login screen and in About | `VITE_PRIVACY_URL` |
| The names of export files and crash-backup files | made from `VITE_APP_NAME` |
| PWA manifest description, HTML meta description | `VITE_APP_DESCRIPTION` |
| Header mark, favicon, PWA icon | `VITE_APP_ICONS_DIR` |
| The welcome dialog on the first visit, on or off | `VITE_APP_WELCOME`, or the `welcome-dialog` meta tag in a release bundle |

No translated string contains the name. The message catalogues have an `{appName}` placeholder,
which the app fills when it renders. Thus, a rebrand applies to all locales at the same time. A test
fails if a catalogue contains the name as a literal.

A placeholder cannot inflect, because a translation cannot know how a different name inflects. Thus,
each message keeps the placeholder in its base form. The welcome dialog says "Tämä on {appName}",
not "Tervetuloa {appName}on". Thus, one text is correct for all deployment names.

These are not parametrised. Each is a change of one line in the source:

- **Theme color** `#2563eb`, in `packages/client/index.html` (`<meta name="theme-color">`) and
  `packages/client/public/manifest.webmanifest` (`theme_color`). It gives the color of the browser
  bar in the light theme. In the dark theme, the app paints that bar with the background of its
  header.
- **The repository link** in Settings → About, in
  `packages/client/src/components/settings/AboutSettings.tsx`.

We do not change these on purpose: the `manifesto:` `localStorage` keys and the `@manifesto/*`
workspace package names. They are internal identifiers. A change to the storage keys loses the
existing notes in the browsers of the users.

## Tracking upstream

The brand assets stay outside the repository so that an upgrade is a fast-forward, not a merge
conflict:

```bash
git pull && pnpm install
VITE_APP_NAME="Corporate Notes" ... pnpm --filter @manifesto/client build
```

Put the environment variables in `packages/client/.env` (gitignored, see `.env.example`), not on the
command line. Then the build is only `pnpm build`. For the server, change the tag in your compose
file.

## See also

- [Operating Modes](operating-modes.md): open mode and connected mode, storage and auth options
- [Client Deployment](client/deployment.md): static hosting, PWA, configuration at build time
- [Server Deployment](server/deployment.md): Docker, environment, reverse proxy, OIDC, Postgres
