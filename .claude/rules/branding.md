---
paths:
  - "packages/client/src/config.ts"
  - "packages/client/src/serverOrigin*.ts"
  - "packages/client/index.html"
  - "packages/client/vite.config.ts"
  - "packages/client/public/**"
  - "packages/client/src/components/BrandLogo.tsx"
  - "packages/client/src/utils/serverCsp.ts"
  - "packages/client/src/storage/apiRequest.ts"
  - "packages/client/src/state/auth.ts"
  - "packages/client/src/main.tsx"
  - "docs/specification/custom-instances.md"
---

# Branding

The product name is a deployment parameter, never a literal. `src/config.ts`
exports `APP_NAME` (plus `APP_FILE_SLUG` for download filenames and
`APP_LOGO` for the header mark), resolved from the `application-name` meta
tag in `index.html` if present, else the build-time `__APP_NAME__` that
`vite.config.ts` derives from `VITE_APP_NAME`. The meta-tag layer is what lets
someone rebrand a prebuilt release zip without a toolchain, so keep new
user-facing name usages going through `APP_NAME` rather than `__APP_NAME__`.

Message catalogues use an `{appName}` placeholder, which `t()` fills in
automatically, and a test fails if either catalogue hard-codes "Manifesto".
A translation cannot know how another name declines, so every message is
phrased to leave the placeholder uninflected: Finnish says "Tämä on {appName}",
never "{appName}on". Reach for a rewording, not a special case, when a
language wants to bend the name.

Branding has two halves. The app's own name and mark (`APP_NAME`, `APP_LOGO`) replace
Manifesto's; the deployment's (`INSTANCE_NAME`, `INSTANCE_LOGO`, `ORG_NAME`, `ORG_LOGO`, all null unless set)
sit beside the app's; only `HEADER_BRAND` swaps the instance into the top bar, and About
names the app whatever it says. Every one is a meta tag in `index.html` over a
build-time value (`__APP_NAME__`, `__BRANDING__`), and the logo variables are files the build
publishes as `app-logo.<ext>`, `instance-logo.<ext>`, `org-logo.<ext>`, each with an optional
`-dark` variant. A logo is a `Logo` (light, dark, `invertInDark`) and is drawn through
`BrandLogo`, never a bare `<img>`: it picks the variant by the app's `.dark` class, and inverts
only the app's logo, only when it has no dark variant.

Besides those, two more deployment parameters are read from `index.html`:
`welcome-dialog` and `manifesto-server` (`resolveServerUrl`, feeding `SERVER_URL` /
`isServerMode` in `state/auth.ts`). The last one is not branding and carries a trap the others
do not. The server address and the CSP
that permits reaching it live in the same file, and the build writes both
together (`cspForServer` derives `connect-src` from `VITE_MANIFESTO_SERVER`)
while a hand edit writes one and forgets the other. Forgetting it gives a login
screen whose every request is blocked before it is sent, which says nothing about
the cause, so `main.tsx` compares the two at boot and renders `ServerSetupError`
instead of the app. `utils/serverCsp.ts` holds that comparison and is
deliberately fail-open: no CSP meta tag, or none naming `connect-src` or
`default-src`, means no judgement, because a false alarm would take down a
deployment that works. The case that must keep passing it is a same-origin
server, which the stock `connect-src 'self'` already covers, since CSP3 extends
`'self'` to the `wss://` form of the page's own host; that is what makes a
single-origin deployment a one-line edit with no policy change.

A relative server value is supported and is the tidiest way to configure a
single-origin deployment: `/` resolves to the **empty string**, which means this
page's own origin and is not the same as null, which is open mode. So every
guard on `SERVER_URL` (and on `storageConnection.serverUrl`) tests `=== null`
and never falsiness; a falsy test sends a same-origin deployment down the
open-mode branch. Account-level requests (admin, sharing, tokens, webhooks,
two-factor) go through `storage/apiRequest.ts`, which holds that check once, so
a new one should too rather than calling `fetch` itself. A relative base is
right for `fetch` and useless to a `WebSocket`, so `resolveServerOrigin` spells
it out from `window.location` once and `SERVER_ORIGIN` / `WS_ORIGIN` are what
the sockets and the "your notes are on <host>" copy read.

`VITE_APP_DESCRIPTION` fills `%APP_DESCRIPTION%` in `index.html` and the web
manifest. `VITE_APP_ICONS_DIR` overlays replacement icons onto the output, which
is why `logo.svg` lives in `public/` rather than `src/assets/`: brand marks
must stay plain files at fixed paths. `manifesto:` localStorage keys and the
`@manifesto/*` package names are internal and stay as they are.
