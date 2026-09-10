# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Manifesto is a free, open-source note-taking app with a sticky note interface. It's MIT licensed. The full spec lives in `docs/specification/`.

## Commands

```bash
pnpm install          # Install all dependencies
pnpm dev              # Run client and server dev servers in parallel
pnpm build            # Build all packages
pnpm lint             # Check linting and formatting (Biome)
pnpm lint:fix         # Auto-fix lint/format issues
pnpm typecheck        # TypeScript check all packages
pnpm test             # Run all tests (Vitest)
```

Run for a single package with `pnpm --filter @manifesto/<client|server|shared> <script>`.

Run a single test file: `pnpm --filter @manifesto/client exec vitest run src/path/to/file.test.ts`
(the packages have no `vitest` script — `exec` reaches the binary). Add `--project node` or
`--project browser` to run just one of the client's two test projects.

## Architecture

pnpm monorepo with three packages:

- **`packages/shared`** — TypeScript types and enums (`Note`, `NoteColor`, `NoteVersion`, API types). Imported by both client and server. No runtime dependencies — types only.
- **`packages/client`** — Preact + TypeScript SPA, built with Vite. Uses @preact/signals for state, Tailwind v4 (via `@tailwindcss/vite`, no config file) for styling, Vitest for tests.
- **`packages/server`** — Node.js + TypeScript, Hono. Storage and authentication are pluggable behind `StorageDriver` and `AuthProvider` interfaces. Two storage drivers ship: SQLite (`better-sqlite3`, default) and Postgres (`pg`). Two auth providers ship: local (argon2 + sessions, default) and OIDC. The client also works standalone with localStorage in open mode, so the server is optional.

### Key Design Decisions

- **Local-first**: Client works fully offline using localStorage (open mode). Server connection is opt-in.
- **Managed mode**: Organizations can deploy as server-only (no local storage, auth required).
- **Storage adapters**: Client abstracts data access behind `StorageAdapter` interface — `LocalStorageAdapter` (default) or `RestApiAdapter` (server-connected). Factory in `storage/index.ts`.
- **ULIDs** for note IDs (not UUIDs) — lexicographically sortable, timestamp-prefixed.
- **NoteColor** uses named enums (not hex) so themes can map colors differently for light/dark mode.

### Client State Management

State lives in `packages/client/src/state/` using @preact/signals:

- **`actions.ts`** — Core signals (`notes`, computed `filteredNotes`/`sortedNotes`/`allTags`), and async action functions (`createNote`, `updateNote`, `trashNote`, `bulkArchive`, etc.). Actions modify both signals and the storage adapter.
- **`ui.ts`** — UI state signals (`editingNoteId`, `activeView`, `searchQuery`, `selectedNotes`).
- **`prefs.ts`** — User preferences persisted to `localStorage` key `manifesto:prefs` with debounced `effect()`.
- **`router.ts`** — Two-way sync between `activeView`/`activeTag` and the URL hash. `initRouter()` is called once from `App` on mount.
- **`auth.ts`** — Server-mode auth: `authToken` / `currentUser` signals persisted to `localStorage` key `manifesto:auth`. `login` / `register` POST to `/api/auth/*`. `LoginScreen` queries `/api/auth/methods` on mount and renders either the local form or a single "Continue with SSO" button (linking to `${SERVER_URL}/api/auth/login`) depending on the active provider. After an OIDC callback the server redirects to the client with `#token=...`; `consumeOidcRedirect()` runs once on `App` mount, fetches `/api/auth/me`, populates the signals, and strips the fragment from the URL.

### Branding

The product name is a deployment parameter, never a literal. `src/config.ts`
exports `APP_NAME` (plus `APP_FILE_SLUG` for download filenames and
`APP_LOGO_URL` for the header mark), resolved from the `application-name` meta
tag in `index.html` if present, else the build-time `__APP_NAME__` that
`vite.config.ts` derives from `VITE_APP_NAME`. The meta-tag layer is what lets
someone rebrand a prebuilt release zip without a toolchain, so keep new
user-facing name usages going through `APP_NAME` rather than `__APP_NAME__`.

Message catalogues use an `{appName}` placeholder, which `t()` fills in
automatically — a test fails if either catalogue hard-codes "Manifesto".
Translations must not inflect it (Finnish says "Kirjaudu palveluun {appName}",
not "Manifestoon").

`VITE_APP_DESCRIPTION` fills `%APP_DESCRIPTION%` in `index.html` and the web
manifest. `VITE_APP_ICONS_DIR` overlays replacement icons onto the output, which
is why `logo.svg` lives in `public/` rather than `src/assets/` — brand marks
must stay plain files at fixed paths. `manifesto:` localStorage keys and the
`@manifesto/*` package names are internal and stay as they are.

### Routing

`state/router.ts` syncs `activeView` / `activeTag` with `location.pathname` (base-prefixed from Vite's `BASE_URL`). Paths: `/` → active, `/tags` / `/tags/<tag>` → tags, `/reminders`, `/archived`, `/trash`. The `githubPagesSpaFallback` Vite plugin copies `dist/index.html` to `dist/404.html` so GitHub Pages serves the SPA for any unknown path.

### Version History

Notes have persistent version history stored LZ-String compressed in `localStorage` key `manifesto:versions`. Versions are saved automatically when the editor closes with changes (capturing the pre-edit state). Capped at 50 per note, pruned after 90 days. Storage module: `storage/VersionStorage.ts`. UI: `components/VersionHistory.tsx`, accessed via kebab menu in the note editor.

### Editor

Markdown editing uses **Milkdown** (`@milkdown/kit`) with the CommonMark + GFM presets, plus the `history`, `clipboard`, and `listener` plugins. The editor instance is wired up in `hooks/useMilkdownEditor.ts` and rendered by `components/MilkdownEditor.tsx`. Undo/redo flows through Milkdown's history plugin (called via `callCommand(undoCommand)` / `redoCommand`) — there is no separate undo/redo hook. Custom ProseMirror behavior lives in `packages/client/src/extensions/` (`manifestoInlineMarks` for inline marks, `taskItemDraggable` for drag-and-drop checklist items). Read-only previews are rendered by `utils/remarkRenderer.ts` (remark → rehype → sanitized HTML via DOMPurify).

`MilkdownEditor` reads markdown via `getMarkdown()` and post-processes it (`unescapeBrackets`, `collapseListSpread`) to keep round-trips stable with our preview.

**Collaborative binding.** Once `collab` is supplied, the shared `Y.XmlFragment` is the authority
and the `content` prop must never be written into a fragment that already holds something — doing
so deletes another session's work on every device at once. Three pieces enforce that, and the
tests in `MilkdownEditor.browser.test.tsx` / `NoteCardEditor.browser.test.tsx` fail if any one is
removed: `NoteCardEditor` withholds `collab` until the provider reports `synced`, `NoteEditor` keys
the editor on `collab` so it rebuilds with the plugin installed, and `MilkdownEditor` seeds the
fragment from the note *only* when it is empty. Any effect with `editor` in its dep array also runs
at mount, after `ySyncPlugin` has rendered the shared document — so an effect that pushes local
content must first establish that it is reacting to a change and not to the editor's arrival.

### Auto-notes Plugin Sandbox

Auto-notes run user-supplied JavaScript, so it executes at three removes from the app and each
remove is load-bearing:

- `public/autonotes-sandbox.html` is loaded via `iframe.src` with `sandbox="allow-scripts"` and no
  `allow-same-origin` — an opaque origin, so no host storage, cookies or DOM. It can't be `srcdoc`:
  those inherit our `script-src 'self'`, while a frame from a real URL carries its own CSP.
- Inside the frame, the plugin runs in a blob `Worker` (hence `worker-src blob:` in that CSP). This
  is what makes the 2s timeout in `autoNotes/sandbox.ts` enforceable — a plugin that never returns
  occupies only the worker's thread. An engine that refuses a worker at an opaque origin gets a
  fallback to frame-thread execution, reported in `init-ok` and warned about by the host.
- The frame returns `JSON.stringify({ value })` and validates nothing; `autoNotes/results.ts`
  decides what is a note. Keep it that way — a plugin that subverts the frame passes the frame's
  own checks.

### Component Patterns

- **NoteEditor** is fully prop-driven (title, content, color, font, callbacks). Parent components (`NoteCardEditor`, `NoteInput`) own the state.
- **NoteCardEditor** wraps NoteEditor for editing existing notes — manages auto-save (500ms debounce) and version history. Undo/redo is delegated to Milkdown.
- **Dropdown** is the generic popover pattern (used for color picker, font picker, kebab menu) — `open`/`onClose`/`trigger`/`children` props.

### API Contract

`packages/shared/src/api.ts` declares the wire types and `docs/specification/api.md` is the source of truth.

- REST: `/api/notes`, `/api/search`, `/api/auth/*` (auth routes are owned by the active auth provider)
- WebSockets: `/api/ws` (application events, presence) and `/api/yjs` (Hocuspocus collaboration — one socket for every note, the note id is the document name). `/api/ws` authenticates via `Sec-WebSocket-Protocol`; `/api/yjs` authenticates in the Hocuspocus `Auth` message and authorizes ownership of the joined document in `onAuthenticate`.
- All timestamps are ISO 8601 UTC strings
- Note schema — see `docs/specification/data-model.md`

### Server Architecture

Two pluggable layers, both selected at boot via env vars (`STORAGE_DRIVER`, `AUTH_PROVIDER`):

- **`src/storage/`** — `StorageDriver` interface in `types.ts`. Bundles `users`, `sessions`, `notes`, `yjs`, `maintenance` repos. Two drivers: `src/storage/sqlite/` (sync `better-sqlite3` wrapped in async-typed methods) and `src/storage/postgres/` (`pg` Pool, true-async). Schema parity is intentional — SQLite uses `INTEGER` booleans and `BLOB`s, Postgres uses native `BOOLEAN` and `BYTEA`, but the typed `Note`/`User`/etc. shapes returned to callers are identical. Tests for the Postgres driver run against `pg-mem`, so CI doesn't need a real Postgres. Storage construction is async (`await createStorage(cfg)`) since Postgres migrations require a query round-trip.
- **`src/auth/`** — `AuthProvider` interface in `types.ts`. Each provider exposes `authenticate(token)` for middleware/WS handshakes and owns its own `/api/auth/*` router. Two providers ship: `src/auth/local/` (username + argon2) and `src/auth/oidc/` (OAuth 2.0 Authorization Code + PKCE via `openid-client`, with JIT user provisioning by `(provider, sub)`). Both share `src/auth/session.ts` for session mint and bearer-token validation, so `authenticate()` is identical across providers — the IdP only matters at login time. The `users` schema has nullable `password_hash` plus `provider` and `external_id` columns so SSO and local users coexist in the same table. Two provider-agnostic endpoints live in `src/auth/sharedRoutes.ts` and are mounted alongside the active provider: `GET /api/auth/methods` (public discovery) and `GET /api/auth/me` (bearer → current user).
- **`src/app.ts` / `src/index.ts`** — composition root. Constructs storage, auth provider, broadcaster, then wires the Hono app, the `/api/ws` socket (`ws/appSocket.ts`), and the Yjs collaboration socket (`ws/yjsSocket.ts` + the generic `ws/yjsExtension.ts` Hocuspocus extension that delegates to `storage.yjs`).
- **Background work**: `lib/trashCleanup.ts` runs hourly and goes through `storage.maintenance.cleanupTrashedBefore()` rather than touching the DB directly, so it works for any storage driver.

## Testing

- Vitest. The client's suite is split into two projects by filename: `*.browser.test.ts` runs in a
  real headless Chromium via Playwright, everything else runs in Node. A test takes the `.browser`
  name when it needs a DOM — real CSS, `localStorage`, history, an iframe, DOMPurify — which is what
  keeps the pure majority (parsers, mergers, schedulers, formatters) fast. The server's suite is
  Node-only.
- Test files are colocated with source (e.g., `actions.browser.test.ts` next to `actions.ts`)
- Tests use real `localStorage` — clear in `beforeEach`/`afterEach`
- Signal state is set directly in tests (e.g., `notes.value = []`)

## Code Style

- Biome for linting and formatting (not ESLint/Prettier)
- TypeScript strict mode in all packages
- `type: "module"` (ESM) throughout

## Rules

- Never use `git stash` for any purpose
