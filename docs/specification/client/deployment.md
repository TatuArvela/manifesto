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
| `VITE_MANIFESTO_SERVER`   | unset   | Absolute URL of the Manifesto server. Unset → open mode. Set → connected mode.               |
| `VITE_APP_NAME`           | `Manifesto` | Branding: the product name, description and icons. See [Rebranding](#rebranding).       |
| `VITE_APP_WELCOME`        | on      | The first-visit welcome dialog. See [Welcome dialog](#welcome-dialog).                       |

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

The server's `CORS_ORIGINS` must include the client's deployed origin, or the browser will block requests.

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

| What | Variable | Default |
|---|---|---|
| Product name | `VITE_APP_NAME` | `Manifesto` |
| One-line description (PWA manifest + HTML `<meta name="description">`) | `VITE_APP_DESCRIPTION` | `Sticky-note style note-taking app.` |
| Brand marks | `VITE_APP_ICONS_DIR` | the stock `public/` icons |

Not parametrised: the theme colour (`#2563eb`, in `index.html` and
`manifest.webmanifest`) and the repository link in Settings → About.

### Building from source

Set the variables at build time. They are resolved once in `vite.config.ts` and
reach the bundle, `index.html`, and `manifest.webmanifest` together, so those
cannot drift apart.

```bash
VITE_APP_NAME="Corporate Notes" \
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

| File | What to change |
|---|---|
| `index.html` | `<title>`, `<meta name="application-name">`, `<meta name="description">`, and `<meta name="welcome-dialog">` to switch the welcome off |
| `404.html` | the same tags (it is a copy of `index.html` for SPA fallback) |
| `manifest.webmanifest` | `name`, `short_name`, `description` |
| `logo.svg`, `favicon.svg`, `icon-1024.png` | overwrite with your own |

```bash
sed -i '' 's/Manifesto/Corporate Notes/g' index.html 404.html manifest.webmanifest
cp ~/acme-brand/*.svg ~/acme-brand/icon-1024.png .
```

The `application-name` meta tag wins over whatever the bundle was built with, so
this works on any build. Leave the JS bundle alone: it is minified, and the
`manifesto:` prefixes inside it are `localStorage` keys, and rewriting those would
orphan every note already saved in a browser.

## Routing for static hosts

Manifesto uses real URL paths (not hash fragments) for navigation, so deep links like `/archived` or `/tags/work` need to fall back to `index.html`. The Vite plugin `githubPagesSpaFallback` copies `dist/index.html` to `dist/404.html` after each build, which handles GitHub Pages out of the box. For other hosts:

- **nginx / Caddy / Apache**: configure a fallback rewrite to `index.html` for any non-asset request.
- **Netlify**: drop a `_redirects` file with `/* /index.html 200`.
- **Cloudflare Pages / Vercel**: SPA fallback is enabled by default.

If hosting under a subpath, set Vite's `base` to match (e.g. `/manifesto/` for `https://user.github.io/manifesto/`); the router and the `manifest.webmanifest` rewrite plugin both honour `BASE_URL`.

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
- Open-mode builds work fully offline. Connected-mode builds load from cache when offline but cannot read or write notes until the network returns.
