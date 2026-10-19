# Client Deployment

The client builds to a static site that any server can serve. The build sets the operating mode. See
[Operating Modes](../operating-modes.md) for the concepts.

## Build

```bash
pnpm install
pnpm --filter @manifesto/client build
# Produces packages/client/dist/ with index.html + assets
```

## Hosting Options

- Any static file server (nginx, Apache, Caddy)
- GitHub Pages, Netlify, Vercel, Cloudflare Pages
- Docker (only to serve static files)
- Open `index.html` directly in a browser (open mode)

## Configuration

The build sets all of the values that the client needs. `VITE_MANIFESTO_SERVER` selects the
operating mode:

| Variable                  | Default | Description                                                                                  |
|---------------------------|---------|----------------------------------------------------------------------------------------------|
| `VITE_MANIFESTO_SERVER`   | unset   | The absolute URL of the Manifesto server. Not set → open mode. Set → connected mode. You can point a built bundle to a different server without a new build, through the `manifesto-server` meta tag. See [Pointing a release bundle at a server](#pointing-a-release-bundle-at-a-server). |
| `VITE_APP_NAME`           | `Manifesto` | Branding: the name, logo, description and icons of the app, and optionally the instance and the organization that operates it. See [Rebranding](#rebranding). |
| `VITE_APP_WELCOME`        | on      | The welcome dialog on the first visit. See [Welcome dialog](#welcome-dialog).                |
| `MANIFESTO_BASE_URL`      | `/`     | The path of the site. Set it to `/notes/` to host under a subpath. It is not a `VITE_` variable, because Vite reads `base` before it loads those variables. |

The Vite config also reads `VITE_MANIFESTO_SERVER` to extend the Content Security Policy of
`index.html`. When it is set, the build adds the HTTP and `ws(s)://` origins of the URL to
`connect-src`. When it is not set, the CSP stays at `connect-src 'self'`, and the build cannot
connect to an external server. This is a good defence-in-depth check that an open-mode build is
really local. For the same reason, the note fonts are in the bundle. Thus, `font-src` and `style-src`
also name no third party.

### Open mode

Build without `VITE_MANIFESTO_SERVER`. The client uses `LocalStorageAdapter`, never shows
`LoginScreen`, and works without network access after the first paint.

```bash
pnpm --filter @manifesto/client build
```

### Connected mode

Build with `VITE_MANIFESTO_SERVER=<absolute-url>`. The client shows only `LoginScreen` until it gets
a session token (from a local-auth login form, or from the OIDC `#token=...` fragment). Then it
connects to the server through REST and WebSocket.

```bash
VITE_MANIFESTO_SERVER=https://server.example.com \
  pnpm --filter @manifesto/client build
```

The `CORS_ORIGINS` of the server must include the deployed origin of the client. If not, the browser
blocks the requests. This does not apply when both come from
[one origin behind one proxy](../server/deployment.md#single-origin-behind-one-reverse-proxy).

A build is not the only method. You can set the same value in the `index.html` of a prebuilt bundle.
Thus, the published zip can become a connected client. See
[Pointing a release bundle at a server](#pointing-a-release-bundle-at-a-server).

## Welcome dialog

On the first visit of a browser, a short welcome opens. It tells what the app is and, most
important, where the notes are saved:

- In open mode: in this browser. It tells what that means for sync and for a clear of the site data.
- In connected mode: on the named server, under the signed-in account.

It shows one time for each browser. You can open it again from **About** at the bottom of Settings.
If an open-mode browser already has notes, the app thinks that it saw the dialog. Thus, when you
upgrade an existing instance, the app does not welcome its users as new.

It is on by default. To remove it, build with `VITE_APP_WELCOME=off`. In a release bundle, set the
meta tag in `index.html` (and `404.html`):

```html
<meta name="welcome-dialog" content="off" />
```

## Privacy notice

A deployment for other people puts a link to its privacy notice on the sign-in screen, where accounts
are made, and in About in Settings. Build with `VITE_PRIVACY_URL`. In a release bundle, set the meta
tag in `index.html` (and `404.html`):

```html
<meta name="privacy-url" content="https://example.com/privacy" />
```

It accepts an `https://` (or `http://`) address, or a path on the same site, for example
`/privacy.html`. For all other values, no link shows. If it is not set, there is no link.
[Privacy](../features/privacy.md#the-operators-privacy-notice) is a start for its text.

## Rebranding

For a full branded deployment from start to end, see [Custom Instances](../custom-instances.md).
This section is the reference for the build-time settings.

No text in the UI contains "Manifesto" as a literal. One value gives the name to the window title,
the PWA manifest, the header, the login screen, the names of export and crash-backup files, and each
translated string. The translations contain an `{appName}` placeholder, not the name. The description
and the brand marks are also parameters.

Branding has two parts:

- The **app** is the product: its name and mark. They are those of Manifesto, unless you replace
  them.
- The **instance** and the **organization** tell who operates this copy. All are optional. They show
  together with the app, not in place of it: "Manifesto · Foo QA project", owned by Acme Inc. The app
  shows the organization only by its name, with no "provided by", because to own an instance is not
  the same as to provide a service.

| What | Variable | Meta tag | Default |
|---|---|---|---|
| App name | `VITE_APP_NAME` | `application-name` | `Manifesto` |
| App logo | `VITE_APP_LOGO` | `app-logo` | `logo.svg` (the Manifesto mark) |
| Instance name | `VITE_INSTANCE_NAME` | `instance-name` | none |
| Instance logo | `VITE_INSTANCE_LOGO` | `instance-logo` | none |
| Top bar brand: `app` or `instance` | `VITE_HEADER_BRAND` | `header-brand` | `app` |
| App name in the window title after the name of the instance: `on` or `off` | `VITE_TITLE_APP_NAME` | `title-app-name` | `on` |
| Dark-theme variant of the three logos | `VITE_APP_LOGO_DARK`, `VITE_INSTANCE_LOGO_DARK`, `VITE_ORG_LOGO_DARK` | `app-logo-dark`, `instance-logo-dark`, `org-logo-dark` | none |
| Organization name | `VITE_ORG_NAME` | `org-name` | none |
| Organization logo | `VITE_ORG_LOGO` | `org-logo` | none |
| Address of the privacy notice | `VITE_PRIVACY_URL` | `privacy-url` | none |
| One-line description (PWA manifest + HTML `<meta name="description">`) | `VITE_APP_DESCRIPTION` | `description` | `Sticky-note style note-taking app.` |
| Favicon, PWA icon, and the usual logo file | `VITE_APP_ICONS_DIR` | | the usual `public/` icons |

Where each one shows:

| Surface | App name | App logo | Instance | Organization |
|---|---|---|---|---|
| Window title | yes, unless `VITE_TITLE_APP_NAME=off` and there is an instance | | first, as "Foo QA project · Manifesto" | |
| Header (Notes view), `app` brand | yes | yes | adjacent to the name, muted. On a phone, it is the first item to go | |
| Header (Notes view), `instance` brand | | | its logo and name, in place of those of the app | |
| Browser tab icon, `instance` brand | | | its logo, if it has one, in place of `favicon.svg` | |
| Loading screen, `app` brand | yes | yes | under the name, muted | |
| Loading screen, `instance` brand | | | its logo and name, in place of those of the app | |
| Sign-in screen | heading | yes | under the heading | logo and name at the bottom |
| Settings → About | yes | yes, with the version | logo and name, under the app | logo and name |
| Authenticator app entry (two-factor) | yes | | as "Manifesto (Foo QA project)" | |
| Welcome dialog, messages, filenames | yes | yes (dialog) | | |

`VITE_HEADER_BRAND=instance` gives the top bar to the instance: its logo, if it has one, and its
name, in place of the mark and name of the app. It needs an instance name. Without one, the app
shows. The loading screen shows the same brand as the top bar. The logo of the instance then also
becomes the icon of the browser tab. The icon of the
installed app (`icon-1024.png`) does not change. Settings → About still names the app, with its mark
and version.

The logo variables take an image file. The build publishes it adjacent to `index.html` as
`app-logo.<ext>`, `instance-logo.<ext>` or `org-logo.<ext>`, and writes that name into the meta tag.
If a path is not a file, the build ignores it and shows a warning. The logos of the instance and of
the organization can be wider than they are tall.

Each logo can have a dark variant. The app draws the variant in place of the logo while the theme of
the app is dark (the theme setting, selected or from the system). The build publishes it as
`<name>-dark.<ext>`.

- Without a dark variant, the app inverts the app logo in the dark theme, as the usual logo. Thus, a
  dark shape with one color is best there. The app draws the logos of the instance and of the
  organization as they are.
- A variant needs its light logo. Alone, it replaces nothing, and the app ignores it.
- The tab icon gets the dark variant of the instance logo from the color scheme of the browser, not
  from the page, because the tab belongs to the browser.
- A meta tag contains a file name adjacent to `index.html`, an absolute path, or a `data:` URL. It
  cannot contain a remote URL, because the `img-src 'self'` of the page refuses it.

Not parametrised: the theme color (`#2563eb`, in `index.html` and `manifest.webmanifest`) and the
repository link in Settings → About.

### Building from source

Set the variables at build time. `vite.config.ts` resolves them one time. They go to the bundle,
`index.html` and `manifest.webmanifest` together. Thus, those files always agree.

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

`VITE_APP_ICONS_DIR` is a folder of replacement images. The build puts them over the build output.
It reads each file separately. Thus, the folder must contain only the files that you want to change:

| File | Where it shows |
|---|---|
| `logo.svg` | the mark adjacent to the title in the header |
| `favicon.svg` | the browser tab |
| `icon-1024.png` | the installed PWA and the iOS home screen |

Keep the folder outside the repository. You can edit the `public/` files in the repository, but then
each `git pull` from upstream gives a conflict.

### Rebranding a release bundle

`manifesto-client-vX.Y.Z.zip` has the usual branding. But you do not need a toolchain to change it:
the app reads its name from the HTML when it starts, and the icons are plain files at fixed paths.
Unzip the bundle and edit it in place.

The release bundle is in open mode. You can point it to a server with edits to the same file. See
[Pointing a release bundle at a server](#pointing-a-release-bundle-at-a-server) below. That needs two
edits, not one.

| File | What to change |
|---|---|
| `index.html` | `<title>`, `<meta name="application-name">`, `<meta name="description">`, the `app-logo`, `instance-name`, `instance-logo`, `header-brand`, `title-app-name`, `org-name` and `org-logo` meta tags (and the `-dark` tag of each logo), `<meta name="welcome-dialog">` to switch off the welcome, and `<meta name="privacy-url">` for the privacy notice |
| `404.html` | the same tags (it is a copy of `index.html` for the SPA fallback) |
| `manifest.webmanifest` | `name`, `short_name`, `description` |
| `logo.svg`, `favicon.svg`, `icon-1024.png` | replace them with your own files |
| the logo of the instance or of the organization | copy it adjacent to `index.html`, and put its file name in `instance-logo` or `org-logo` |

```bash
sed -i '' 's/Manifesto/Corporate Notes/g' index.html 404.html manifest.webmanifest
cp ~/acme-brand/*.svg ~/acme-brand/icon-1024.png .
```

The `application-name` meta tag wins over the value of the build. Thus, this works on all builds. Do
not change the JS bundle. It is minified. The `manifesto:` prefixes inside it are `localStorage`
keys. If you change them, the app loses all notes that are already saved in a browser.

## Pointing a release bundle at a server

`manifesto-client-vX.Y.Z.zip` is built in open mode. It also needs no toolchain to become a connected
client. You must do **two** edits in `index.html`, not one. People frequently forget the second edit:

```html
<!-- 1. the server -->
<meta name="manifesto-server" content="https://notes.example.com" />

<!-- 2. the policy, or the browser blocks every request to it -->
<meta http-equiv="Content-Security-Policy" content="... connect-src 'self' https://notes.example.com wss://notes.example.com ..." />
```

Both origins are necessary. The `https://` origin carries REST. The `wss://` origin carries
`/api/v1/ws` and `/api/v1/yjs`. If you add only the first, the client signs in but never syncs, and
it tells you very little about the cause. Do the same edits in `404.html`, the copy for the SPA
fallback.

The app tells you if the two do not agree. When it starts, it compares the tag with the policy in the
same document. When they do not agree, it shows which origins are missing. It does not show a login
screen whose requests fail silently. It does the same when the address is not a full URL.

In two cases, you do not have to edit the CSP.

A **single-origin deployment**, where one proxy serves the bundle and `/api/v1/*` from the same host,
already works with the usual `connect-src 'self'`. CSP3 extends `'self'` to the `wss://` form of the
host of the page. Thus, the sockets are also permitted. Do not change the policy. Set only the tag:

```html
<meta name="manifesto-server" content="/" />
```

`/` means "the origin of this page". Thus, the client needs no hostname of its own, and if the domain
changes, you do not have to update anything. The absolute URL of the site also works.
[server/deployment.md recommends](../server/deployment.md#single-origin-behind-one-reverse-proxy) this
shape for one machine. With it, a connected instance needs only a one-line edit.

A **build from source** with `VITE_MANIFESTO_SERVER` set also needs no tag. `vite.config.ts` makes
the CSP from the same value. Thus, the address and the policy always agree. When both are set, the
tag wins over the build-time value. Thus, you can point a bundle to a different server without a new
build.

The service worker, the router and all other parts follow from this one value. Thus, you do not have
to change other parts of the bundle. As for rebranding, do not change the minified JS.

## Security headers

`index.html` has a Content Security Policy in a meta tag. It covers most of what the app needs. It
cannot do two things. A meta tag cannot contain `frame-ancestors` (CSP3 § 5.4). Also, a meta tag
arrives too late to protect anything other than the document. Add these as real HTTP response
headers on the server that serves the files.

| Header | Value | What it stops |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors 'self'` | Clickjacking: a different site puts the app in a frame and steals clicks through it. The meta-tag CSP cannot express this one. |
| `X-Frame-Options` | `SAMEORIGIN` | The same problem, for browsers that are older than `frame-ancestors`. |
| `X-Content-Type-Options` | `nosniff` | A browser that guesses that a served file is a different type than the type it got. |
| `Referrer-Policy` | `no-referrer` (or `strict-origin-when-cross-origin`) | Note titles and tags that go out through `Referer` on outbound links. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | A downgrade to plain HTTP on a later visit. Add `preload` only after careful thought. It is a one-way change that needs its own submission, and it is slow to undo. |

A site-wide `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` do **not** break
`/autonotes-sandbox.html`, although they seem to. That frame loads with `sandbox="allow-scripts"` and
no `allow-same-origin`. Thus, its document has an opaque origin, which seems to match neither policy.
But the browser checks both against the origin of the framed **URL**, which is the origin of the site.
Thus, the frame renders, and auto-notes continue to run. It needs no exemption. Do not add one,
because the failure does not occur.

[Server Deployment](../server/deployment.md#single-origin-behind-one-reverse-proxy) has a full
example, with these headers and the cache split that the PWA needs.

## Routing for static hosts

Manifesto uses real URL paths (not hash fragments) for navigation. Thus, deep links such as
`/archived` or `/tags/work` must go to `index.html`. The Vite plugin `githubPagesSpaFallback` copies
`dist/index.html` to `dist/404.html` after each build. This works on GitHub Pages without more work.
For other hosts:

- **nginx / Caddy / Apache**: configure a fallback rewrite to `index.html` for all requests that are
  not assets.
- **Netlify**: add a `_redirects` file with `/* /index.html 200`.
- **Cloudflare Pages / Vercel**: the SPA fallback is on by default.

To host under a subpath, build with the correct `MANIFESTO_BASE_URL` (for example
`MANIFESTO_BASE_URL=/manifesto/` for `https://user.github.io/manifesto/`). The router, the asset URLs,
`theme-init.js`, the icons and the `manifest.webmanifest` rewrite plugin all use it. The default is
`/`. Thus, a build for the root of a domain needs nothing.

## PWA

Manifesto is a Progressive Web App:

- `manifest.webmanifest` gives the app metadata (name, icons, theme color).
- A service worker from `vite-plugin-pwa` precaches the app shell, and caches API responses at
  runtime.
  - The precache includes the Latin subset of each note font. Other subsets load on demand.
  - `logo.svg` and `favicon.svg` are cached stale-while-revalidate, not precached. Thus, a mark that
    you replace in a release bundle reaches returning users on their next online visit.
  - The browser controls `icon-1024.png`, because the page never shows it.
- You can install it on mobile and desktop, through "Add to Home Screen" or the install prompt of the
  browser.
- It starts with its loading screen on iOS too.
  - While a home-screen app starts, iOS shows nothing that a page can draw. It shows only an
    `apple-touch-startup-image` that it took at installation.
  - Thus, in Safari the page draws the loading screen onto a canvas at the exact size of the device,
    one time for each orientation and system scheme, and links the four PNGs (`launchImage.ts`).
  - The page draws them from the served page. Thus, they follow a rebranded bundle without a build
    step.
  - iOS takes them when you add the app. An earlier installation keeps its blank launch screen until
    you add the app again.
- It updates itself.
  - A new worker takes control immediately after it installs.
  - The page checks for a new worker each time it comes to the foreground, and each hour while it
    stays there. An installed app that resumes from the background never navigates. Without these
    checks, the browser never looks.
  - After a new version takes control, the page reloads onto it the next time it is hidden or shown
    with no dialog open and no typing (`utils/updateReload.ts`). Thus, a reload never occurs under an
    open editor before its debounced save.
  - Settings > About has a "Force update app" button for when that is not sufficient. It unregisters
    the worker, empties all caches other than `share-target`, and reloads from the network
    (`forceUpdateApp` in `serviceWorker.ts`). It does not operate while offline, because the reload
    has nothing to load.
- It receives shares.
  - The manifest registers a `share_target`. Thus, on a device where the app is installed, "Share
    to..." in a different app lists it. The shared title, text, link and images open in the new-note
    editor.
  - A share is a `POST` to `share-target` under the base URL. A static host cannot answer it. Thus,
    the service worker takes it. It keeps the text and images in a `share-target` cache, and
    redirects to `?share-target`. There, the page gets them, deletes the cache and opens the editor
    (`shareTarget.ts`, `state/incomingShare.ts`).
  - The link gets a link preview, as a pasted link does. The app removes images that are larger than
    the attachment limit, with the usual message.
  - The worker controls each installed app. Thus, the static host never sees that request.
- It takes pages from a bookmarklet, for browsers that the share sheet does not reach.
  - Settings → Features has a link to drag to the bookmarks bar.
  - When you click it on a page, it opens the app in a new tab at `?share-target&title=&url=&text=`,
    with the title, the address and the selected text of the page (a maximum of 4,000 characters of
    text).
  - The page opens those in the new-note editor, as for a share, and removes them from the address
    first.
  - Nothing is saved until you save the note. The bookmarklet sends data only to the address of the
    app (`bookmarkletHref` in `shareTarget.ts`).
- Open-mode builds work fully offline. Connected-mode builds load from the cache when offline, but
  cannot read or write notes until the network comes back.
