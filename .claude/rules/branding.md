---
paths:
  - "packages/client/src/config.ts"
  - "packages/client/src/serverOrigin*.ts"
  - "packages/client/index.html"
  - "packages/client/vite.config.ts"
  - "packages/client/public/**"
  - "packages/client/src/components/BrandLogo.tsx"
  - "packages/client/src/utils/serverCsp.ts"
  - "packages/client/src/utils/privacyUrl.ts"
  - "packages/client/src/storage/apiRequest.ts"
  - "packages/client/src/state/account/auth.ts"
  - "packages/client/src/main.tsx"
  - "docs/specification/custom-instances.md"
---

# Branding

## The product name

The product name is a deployment parameter. It is never a literal. `src/config.ts` exports
`APP_NAME`, `APP_FILE_SLUG` (for the names of downloaded files) and `APP_LOGO` (for the mark in the
header). `APP_NAME` comes from the `application-name` meta tag in `index.html`, if that tag is
present. If not, it comes from `__APP_NAME__`, which `vite.config.ts` makes from `VITE_APP_NAME` at
build time. The meta tag lets a person rebrand a prebuilt release zip without a toolchain. Thus, all
new uses of the name in the UI must go through `APP_NAME`, not `__APP_NAME__`.

The message catalogues use an `{appName}` placeholder, and `t()` fills it automatically. A test
fails if a catalogue contains "Manifesto" as a literal. A translation cannot know how a different
name inflects. Thus, write each message so that the placeholder does not inflect. In Finnish, write
"Tämä on {appName}", never "{appName}on". If a language must inflect the name, write the message
again in a different way. Do not add a special case.

## The two parts of branding

- The name and mark of the app (`APP_NAME`, `APP_LOGO`) replace the name and mark of Manifesto.
- The name and mark of the deployment (`INSTANCE_NAME`, `INSTANCE_LOGO`, `ORG_NAME`, `ORG_LOGO`) are
  shown in addition to those of the app. They are null unless you set them.
- Only `HEADER_BRAND` puts the instance in the top bar. About always shows the name of the app.

Each one is a meta tag in `index.html` over a build-time value (`__APP_NAME__`, `__BRANDING__`). The
logo variables are files. The build publishes them as `app-logo.<ext>`, `instance-logo.<ext>` and
`org-logo.<ext>`, each with an optional `-dark` variant. A logo is a `Logo` (light, dark,
`invertInDark`). Draw it through `BrandLogo`, never with a bare `<img>`. `BrandLogo` selects the
variant from the `.dark` class of the app. It inverts only the logo of the app, and only when that
logo has no dark variant.

The loading screen is the one exception, because it shows before the bundle.
`public/splash-brand.js` applies the same rules to it from the meta tags. Thus, when you change how
`HEADER_BRAND` or a logo resolves, change that file too.

## Other parameters in index.html

The app reads three more deployment parameters from `index.html`:

- `welcome-dialog`.
- `privacy-url` (`PRIVACY_URL`): the privacy notice of the operator. The sign-in screen and About
  link to it. The value becomes the `href` of a link. Thus, it goes through `resolvePrivacyUrl`
  (`utils/privacyUrl.ts`), which accepts only an `http(s):` URL or a path on the site. A new
  parameter that goes into an `href` needs the same check.
- `manifesto-server` (`resolveServerUrl`). It gives `SERVER_URL` and `isServerMode` in
  `state/account/auth.ts`. This one is not branding, and it has a risk that the others do not have.

The server address and the CSP that permits a connection to it are in the same file. The build
writes both together (`cspForServer` makes `connect-src` from `VITE_MANIFESTO_SERVER`). But a manual
edit can change one and not the other. If that occurs, the login screen shows, but the browser
blocks each request before it goes out. Nothing tells the cause. Thus, `main.tsx` compares the two
values when it starts, and shows `ServerSetupError` in place of the app.

`utils/serverCsp.ts` contains that comparison. It is fail-open on purpose. If there is no CSP meta
tag, or the tag has no `connect-src` or `default-src`, it makes no decision. A false alarm stops a
deployment that works. A same-origin server must always pass the check. The usual
`connect-src 'self'` permits it, because CSP3 extends `'self'` to the `wss://` form of the host of
the page. Thus, for a single-origin deployment you change only one line, and not the policy.

## A relative server value

You can use a relative server value. It is the easiest way to configure a single-origin deployment.
`/` resolves to the **empty string**. The empty string means the origin of this page. It is not the
same as null, which means open mode. Thus, each check on `SERVER_URL` (and on
`storageConnection.serverUrl`) tests `=== null`, and never tests falsiness. A falsiness test sends a
same-origin deployment into the open-mode branch.

Account-level requests (admin, sharing, tokens, webhooks, two-factor) go through
`storage/apiRequest.ts`, which does that check one time. Send new requests of this type through it
too. Do not call `fetch` directly. A relative base is correct for `fetch`, but a `WebSocket` cannot
use it. Thus, `resolveServerOrigin` makes the full origin from `window.location` one time. The
sockets and the "your notes are on <host>" text read `SERVER_ORIGIN` and `WS_ORIGIN`.

## Description and icons

`VITE_APP_DESCRIPTION` fills `%APP_DESCRIPTION%` in `index.html` and in the web manifest.
`VITE_APP_ICONS_DIR` puts replacement icons over the output. For this reason, `logo.svg` is in
`public/` and not in `src/assets/`: brand marks must stay plain files at fixed paths. The
`manifesto:` localStorage keys and the `@manifesto/*` package names are internal. Do not change
them.
