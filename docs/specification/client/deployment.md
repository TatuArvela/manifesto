# Client Deployment

The client builds to a static site that can be served by anything. The operating mode is baked in at build time; see [Operating Modes](../operating-modes.md) for the conceptual overview.

## Build

```bash
pnpm install
pnpm --filter @manifesto/client build
# Produces packages/client/dist/ with index.html + assets
```

## Hosting Options

- Any static file server (nginx, Apache, Caddy)
- GitHub Pages, Netlify, Vercel, Cloudflare Pages
- Docker (serving static files only)
- Opening `index.html` directly in a browser (open mode)

## Configuration

Everything the client needs is baked in at build time. `VITE_MANIFESTO_SERVER` is the one that selects the operating mode:

| Variable                  | Default | Description                                                                                  |
|---------------------------|---------|----------------------------------------------------------------------------------------------|
| `VITE_MANIFESTO_SERVER`   | unset   | Absolute URL of the Manifesto server. Unset → open mode. Set → connected mode. A built bundle can be repointed without a rebuild through the `manifesto-server` meta tag; see [Pointing a release bundle at a server](#pointing-a-release-bundle-at-a-server). |
| `VITE_APP_NAME`           | `Manifesto` | Branding: the app's name, logo, description and icons, and optionally the instance and organisation running it. See [Rebranding](#rebranding). |
| `VITE_APP_WELCOME`        | on      | The first-visit welcome dialog. See [Welcome dialog](#welcome-dialog).                       |
| `MANIFESTO_BASE_URL`      | `/`     | The path the site is served from. Set it to `/notes/` to host under a subpath. Not a `VITE_` variable: Vite reads `base` before it loads that set. |

The Vite config also reads `VITE_MANIFESTO_SERVER` to extend the `index.html` Content Security Policy: when set, the URL's HTTP and `ws(s)://` origins are added to `connect-src`. When unset, the CSP stays at `connect-src 'self'` and the build cannot reach any external server, a useful defence-in-depth check that an open-mode build is genuinely local. The note fonts are bundled for the same reason, so `font-src` and `style-src` name no third party either.

### Open mode

Build with `VITE_MANIFESTO_SERVER` unset. The client uses `LocalStorageAdapter`, never renders `LoginScreen`, and works without network access after first paint.

```bash
pnpm --filter @manifesto/client build
```

### Connected mode

Build with `VITE_MANIFESTO_SERVER=<absolute-url>`. The client gates the UI behind `LoginScreen` until a session token is acquired (either from a local-auth login form or by consuming the OIDC `#token=...` fragment), then talks to the server via REST + WebSocket.

```bash
VITE_MANIFESTO_SERVER=https://server.example.com \
  pnpm --filter @manifesto/client build
```

The server's `CORS_ORIGINS` must include the client's deployed origin, or the browser will block requests. It does not come into it when both are served from [one origin behind one proxy](../server/deployment.md#single-origin-behind-one-reverse-proxy).

A build is not the only way in: the same value can be set in a prebuilt bundle's `index.html`, which is what lets the published zip become a connected client. See [Pointing a release bundle at a server](#pointing-a-release-bundle-at-a-server).

## Welcome dialog

A browser's first visit opens a short welcome that says what the app is and,
above all, where notes are saved: in this browser in open mode, with what that
means for syncing and clearing site data, or on the named server under the
signed-in account in connected mode. It is shown once per browser and can be
reopened from **About** at the foot of Settings. An open-mode browser that already holds notes is
treated as having seen it, so upgrading an existing instance does not greet
its users as new.

It is on by default. To leave it out, build with `VITE_APP_WELCOME=off`, or in
a release bundle set the meta tag in `index.html` (and `404.html`):

```html
<meta name="welcome-dialog" content="off" />
```

## Rebranding

For a complete branded deployment end to end, see
[Custom Instances](../custom-instances.md). This section is the reference for
the build-time knobs themselves.

Nothing user-facing spells out "Manifesto". The name flows from one value into
the window title, the PWA manifest, the header, the login screen, export and
crash-backup filenames, and every translated string, since translations carry an
`{appName}` placeholder rather than the name itself. The description and the
brand marks are parameters too.

Branding comes in two parts. The **app** is the product: its name and mark,
Manifesto's unless replaced. The **instance** and **organisation** are who runs
this particular copy, all optional and shown alongside the app rather than in
place of it: "Manifesto · Foo QA project", owned by Acme Inc. The organisation
is shown by its name alone, with no "provided by": owning an instance is not
the same as providing a service.

| What | Variable | Meta tag | Default |
|---|---|---|---|
| App name | `VITE_APP_NAME` | `application-name` | `Manifesto` |
| App logo | `VITE_APP_LOGO` | `app-logo` | `logo.svg` (the Manifesto mark) |
| Instance name | `VITE_INSTANCE_NAME` | `instance-name` | none |
| Instance logo | `VITE_INSTANCE_LOGO` | `instance-logo` | none |
| Top bar brand: `app` or `instance` | `VITE_HEADER_BRAND` | `header-brand` | `app` |
| Dark-theme variant of any of the three logos | `VITE_APP_LOGO_DARK`, `VITE_INSTANCE_LOGO_DARK`, `VITE_ORG_LOGO_DARK` | `app-logo-dark`, `instance-logo-dark`, `org-logo-dark` | none |
| Organisation name | `VITE_ORG_NAME` | `org-name` | none |
| Organisation logo | `VITE_ORG_LOGO` | `org-logo` | none |
| One-line description (PWA manifest + HTML `<meta name="description">`) | `VITE_APP_DESCRIPTION` | `description` | `Sticky-note style note-taking app.` |
| Favicon, PWA icon, and the stock logo file | `VITE_APP_ICONS_DIR` | | the stock `public/` icons |

Where each one shows up:

| Surface | App name | App logo | Instance | Organisation |
|---|---|---|---|---|
| Window title | yes | | first, as "Foo QA project · Manifesto" | |
| Header (Notes view), `app` brand | yes | yes | beside the name, muted; first to give way on a phone | |
| Header (Notes view), `instance` brand | | | its logo and name, in place of the app's | |
| Browser tab icon, `instance` brand | | | its logo, if it has one, in place of `favicon.svg` | |
| Sign-in screen | heading | yes | under the heading | logo and name at the foot |
| Settings → About | yes | yes, with the version | logo and name, under the app | logo and name |
| Authenticator app entry (two-factor) | yes | | as "Manifesto (Foo QA project)" | |
| Welcome dialog, messages, filenames | yes | yes (dialog) | | |

`VITE_HEADER_BRAND=instance` gives the top bar to the instance: its logo, if it
has one, and its name, where the app's mark and name were. It needs an instance
name, and falls back to the app without one. The instance's logo then becomes
the browser tab's icon too; the installed app's icon (`icon-1024.png`) stays. The app is still named, with its
mark and version, in Settings → About.

The logo variables take an image file. The build publishes it beside
`index.html` as `app-logo.<ext>`, `instance-logo.<ext>` or `org-logo.<ext>` and
writes that name into the meta tag; a path that is not a file is left out with a
warning. The instance's and the organisation's logos may be wider than tall.

Each logo can have a dark variant, drawn in its place while the app's theme is
dark (the theme setting, whether chosen or following the system), and published
as `<name>-dark.<ext>`. Without one, the app logo is inverted in the dark theme,
like the stock one, so a dark single-colour shape works best there; the
instance's and the organisation's are drawn as they are. A variant needs its
light logo: on its own it has nothing to stand in for and is ignored. The tab
icon takes the instance logo's dark variant from the browser's own colour
scheme instead, since the tab belongs to the browser, not the page. A meta tag holds a file name
beside `index.html`, an absolute path, or a `data:` URL. Not a remote URL: the
page's `img-src 'self'` refuses it.

Not parametrised: the theme colour (`#2563eb`, in `index.html` and
`manifest.webmanifest`) and the repository link in Settings → About.

### Building from source

Set the variables at build time. They are resolved once in `vite.config.ts` and
reach the bundle, `index.html`, and `manifest.webmanifest` together, so those
cannot drift apart.

```bash
VITE_APP_NAME="Corporate Notes" \
VITE_APP_LOGO=../acme-brand/notes-mark.svg \
VITE_INSTANCE_NAME="Foo QA project" \
VITE_INSTANCE_LOGO=../acme-brand/foo-qa.svg \
VITE_INSTANCE_LOGO_DARK=../acme-brand/foo-qa-dark.svg \
VITE_HEADER_BRAND=instance \
VITE_ORG_NAME="Acme Inc" \
VITE_ORG_LOGO=../acme-brand/acme.svg \
VITE_APP_DESCRIPTION="Shared notes for the Acme team." \
VITE_APP_ICONS_DIR=../acme-brand \
  pnpm --filter @manifesto/client build
```

`VITE_APP_ICONS_DIR` is a folder of replacement images overlaid onto the build
output. It is read per-file, so it only needs to hold what you actually want to
change:

| File | Where it shows up |
|---|---|
| `logo.svg` | the mark beside the title in the header |
| `favicon.svg` | the browser tab |
| `icon-1024.png` | the installed PWA and the iOS home screen |

Keeping the folder outside the repository is the point: editing the checked-in
`public/` files works, but then every `git pull` from upstream is a conflict.

### Rebranding a release bundle

`manifesto-client-vX.Y.Z.zip` is built with the stock branding, but you do not
need a toolchain to change it: the app reads its name from the HTML at startup,
and the icons are plain files at fixed paths. Unzip and edit in place.

The release bundle ships in open mode, and can be pointed at a server by
editing the same file. See
[Pointing a release bundle at a server](#pointing-a-release-bundle-at-a-server)
below, which is two edits rather than one.

| File | What to change |
|---|---|
| `index.html` | `<title>`, `<meta name="application-name">`, `<meta name="description">`, the `app-logo`, `instance-name`, `instance-logo`, `header-brand`, `org-name` and `org-logo` meta tags (and each logo's `-dark` tag), and `<meta name="welcome-dialog">` to switch the welcome off |
| `404.html` | the same tags (it is a copy of `index.html` for SPA fallback) |
| `manifest.webmanifest` | `name`, `short_name`, `description` |
| `logo.svg`, `favicon.svg`, `icon-1024.png` | overwrite with your own |
| the instance's or organisation's logo | copy it beside `index.html` and put its file name in `instance-logo` or `org-logo` |

```bash
sed -i '' 's/Manifesto/Corporate Notes/g' index.html 404.html manifest.webmanifest
cp ~/acme-brand/*.svg ~/acme-brand/icon-1024.png .
```

The `application-name` meta tag wins over whatever the bundle was built with, so
this works on any build. Leave the JS bundle alone: it is minified, and the
`manifesto:` prefixes inside it are `localStorage` keys, and rewriting those would
orphan every note already saved in a browser.

## Pointing a release bundle at a server

`manifesto-client-vX.Y.Z.zip` is built in open mode, and needs no toolchain to
become a connected client either. It is **two** edits in `index.html`, not one,
and the second is the one people forget:

```html
<!-- 1. the server -->
<meta name="manifesto-server" content="https://notes.example.com" />

<!-- 2. the policy, or the browser blocks every request to it -->
<meta http-equiv="Content-Security-Policy" content="... connect-src 'self' https://notes.example.com wss://notes.example.com ..." />
```

Both origins are needed. The `https://` one carries REST, and the `wss://` one
carries `/api/ws` and `/api/yjs`; adding only the first gives you a client that
signs in and then never syncs, which says very little about itself. Make the
same edits in `404.html`, the SPA fallback copy.

If the app is doing this at all, it says so: at startup it compares the tag
against the policy in the same document and, when they disagree, shows which
origins are missing instead of a login screen whose requests die in silence. It
does the same when the address is not a full URL.

Two cases need no CSP edit at all.

A **single-origin deployment**, where one proxy serves the bundle and `/api/*`
from the same host, is already covered by the stock `connect-src 'self'`: CSP3
extends `'self'` to the `wss://` form of the page's own host, so the sockets
are permitted too. Leave the policy alone and set only the tag:

```html
<meta name="manifesto-server" content="/" />
```

`/` means "wherever this page came from", so the client needs no hostname of
its own and there is nothing to update if the domain ever changes. The site's
own absolute URL works too. That shape is what
[server/deployment.md recommends](../server/deployment.md#single-origin-behind-one-reverse-proxy)
for one box, and it makes a connected instance a one-line edit.

A **build from source** with `VITE_MANIFESTO_SERVER` set needs no tag either:
`vite.config.ts` derives the CSP from the same value, so the address and the
policy cannot drift apart. The tag wins over the build-time value when both are
set, which is what lets a bundle be repointed without a rebuild.

The service worker, the router and everything else follow from this one value,
so nothing else in the bundle needs touching. As with rebranding, leave the
minified JS alone.

## Security headers

`index.html` carries a Content Security Policy in a meta tag, and it covers most
of what the app needs. Two things it cannot do: `frame-ancestors` is not allowed
in a meta tag at all (CSP3 § 5.4), and a meta tag arrives too late to protect
anything but the document. Add these as real HTTP response headers on whatever
serves the files.

| Header | Value | What it stops |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors 'self'` | Clickjacking: another site framing the app and stealing clicks through it. The meta-tag CSP cannot express this one. |
| `X-Frame-Options` | `SAMEORIGIN` | The same thing, for anything that predates `frame-ancestors`. |
| `X-Content-Type-Options` | `nosniff` | A browser guessing a served file is a type it was not sent as. |
| `Referrer-Policy` | `no-referrer` (or `strict-origin-when-cross-origin`) | Note titles and tags leaking through `Referer` on outbound links. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | A downgrade to plain HTTP on a later visit. Add `preload` only deliberately: it is a one-way door that needs its own submission and is slow to undo. |

A site-wide `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` do **not**
break `/autonotes-sandbox.html`, despite appearances. That frame is loaded with
`sandbox="allow-scripts"` and no `allow-same-origin`, so its document ends up at
an opaque origin, which looks like it should match neither policy. Both are
checked against the origin of the framed **URL**, which is the site's own, so
the frame renders and auto-notes keep running. It needs no exemption, and
carving one out is the wrong lesson to draw from a failure that does not happen.

A full worked example, with these headers and the caching split the PWA needs,
is in [Server Deployment](../server/deployment.md#single-origin-behind-one-reverse-proxy).

## Routing for static hosts

Manifesto uses real URL paths (not hash fragments) for navigation, so deep links like `/archived` or `/tags/work` need to fall back to `index.html`. The Vite plugin `githubPagesSpaFallback` copies `dist/index.html` to `dist/404.html` after each build, which handles GitHub Pages out of the box. For other hosts:

- **nginx / Caddy / Apache**: configure a fallback rewrite to `index.html` for any non-asset request.
- **Netlify**: drop a `_redirects` file with `/* /index.html 200`.
- **Cloudflare Pages / Vercel**: SPA fallback is enabled by default.

If hosting under a subpath, build with `MANIFESTO_BASE_URL` set to match (e.g. `MANIFESTO_BASE_URL=/manifesto/` for `https://user.github.io/manifesto/`); the router, the asset URLs, `theme-init.js`, the icons and the `manifest.webmanifest` rewrite plugin all honour it. It defaults to `/`, so a build for a domain root needs nothing.

## PWA

Manifesto is a Progressive Web App:

- `manifest.webmanifest` provides app metadata (name, icons, theme color).
- A service worker generated by `vite-plugin-pwa` precaches the app shell and runtime-caches API responses.
  The precache includes the Latin subset of each note font; other subsets load on demand. `logo.svg` and
  `favicon.svg` are cached stale-while-revalidate rather than precached, so a mark swapped into a release
  bundle reaches returning users on their next online visit. `icon-1024.png` is left to the browser, since
  the page never displays it.
- Installable on mobile and desktop via the browser's "Add to Home Screen" / install prompt.
- Updates itself. A new worker takes over as soon as it installs, and the page checks for one whenever it
  returns to the foreground and hourly while it stays there, since an installed app resumed from the
  background never navigates and the browser would otherwise never look. Once a new version has taken
  over, the page reloads onto it the next time it is hidden or shown with no dialog open and nothing being
  typed (`utils/updateReload.ts`), so an open editor is never reloaded out from under its debounced save.
- Receives shares. The manifest registers a `share_target`, so on a device where the app is installed,
  "Share to..." from another app lists it, and the shared title, text, link and images open in the
  new-note editor. A share is a `POST` to `share-target` under the base URL, which a static host cannot
  answer, so the service worker takes it: it parks the text and images in a `share-target` cache and
  redirects to `?share-target`, where the page picks them up, deletes the cache and opens the editor
  (`shareTarget.ts`, `state/incomingShare.ts`). The link gets a link preview as a pasted one does; images
  over the attachment limit are dropped with the usual message. The worker is in control of every
  installed app, so the static host never sees that request.
- Open-mode builds work fully offline. Connected-mode builds load from cache when offline but cannot read or write notes until the network returns.
