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

Run a single test file: `pnpm --filter @manifesto/client vitest run src/path/to/file.test.ts`.

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

### Routing

`state/router.ts` syncs `activeView` / `activeTag` with `location.pathname` (base-prefixed from Vite's `BASE_URL`). Paths: `/` → active, `/tags` / `/tags/<tag>` → tags, `/reminders`, `/archived`, `/trash`. The `githubPagesSpaFallback` Vite plugin copies `dist/index.html` to `dist/404.html` so GitHub Pages serves the SPA for any unknown path.

### Version History

Notes have persistent version history stored LZ-String compressed in `localStorage` key `manifesto:versions`. Versions are saved automatically when the editor closes with changes (capturing the pre-edit state). Capped at 50 per note, pruned after 90 days. Storage module: `storage/VersionStorage.ts`. UI: `components/VersionHistory.tsx`, accessed via kebab menu in the note editor.

### Editor

Markdown editing uses **Milkdown** (`@milkdown/kit`) with the CommonMark + GFM presets, plus the `history`, `clipboard`, and `listener` plugins. The editor instance is wired up in `hooks/useMilkdownEditor.ts` and rendered by `components/MilkdownEditor.tsx`. Undo/redo flows through Milkdown's history plugin (called via `callCommand(undoCommand)` / `redoCommand`) — there is no separate undo/redo hook. Custom ProseMirror behavior lives in `packages/client/src/extensions/` (`manifestoInlineMarks` for inline marks, `taskItemDraggable` for drag-and-drop checklist items). Read-only previews are rendered by `utils/remarkRenderer.ts` (remark → rehype → sanitized HTML via DOMPurify).

`MilkdownEditor` reads markdown via `getMarkdown()` and post-processes it (`unescapeBrackets`, `collapseListSpread`) to keep round-trips stable with our preview.

### Component Patterns

- **NoteEditor** is fully prop-driven (title, content, color, font, callbacks). Parent components (`NoteCardEditor`, `NoteInput`) own the state.
- **NoteCardEditor** wraps NoteEditor for editing existing notes — manages auto-save (500ms debounce) and version history. Undo/redo is delegated to Milkdown.
- **Dropdown** is the generic popover pattern (used for color picker, font picker, kebab menu) — `open`/`onClose`/`trigger`/`children` props.

### API Contract

`packages/shared/src/api.ts` declares the wire types and `docs/specification/api.md` is the source of truth.

- REST: `/api/notes`, `/api/search`, `/api/auth/*` (auth routes are owned by the active auth provider)
- WebSockets: `/api/ws` (application events, presence) and `/api/yjs/notes/<id>` (Hocuspocus collaboration). Both authenticate via `Sec-WebSocket-Protocol`.
- All timestamps are ISO 8601 UTC strings
- Note schema — see `docs/specification/data-model.md`

### Server Architecture

Two pluggable layers, both selected at boot via env vars (`STORAGE_DRIVER`, `AUTH_PROVIDER`):

- **`src/storage/`** — `StorageDriver` interface in `types.ts`. Bundles `users`, `sessions`, `notes`, `yjs`, `maintenance` repos. Two drivers: `src/storage/sqlite/` (sync `better-sqlite3` wrapped in async-typed methods) and `src/storage/postgres/` (`pg` Pool, true-async). Schema parity is intentional — SQLite uses `INTEGER` booleans and `BLOB`s, Postgres uses native `BOOLEAN` and `BYTEA`, but the typed `Note`/`User`/etc. shapes returned to callers are identical. Tests for the Postgres driver run against `pg-mem`, so CI doesn't need a real Postgres. Storage construction is async (`await createStorage(cfg)`) since Postgres migrations require a query round-trip.
- **`src/auth/`** — `AuthProvider` interface in `types.ts`. Each provider exposes `authenticate(token)` for middleware/WS handshakes and owns its own `/api/auth/*` router. Two providers ship: `src/auth/local/` (username + argon2) and `src/auth/oidc/` (OAuth 2.0 Authorization Code + PKCE via `openid-client`, with JIT user provisioning by `(provider, sub)`). Both share `src/auth/session.ts` for session mint and bearer-token validation, so `authenticate()` is identical across providers — the IdP only matters at login time. The `users` schema has nullable `password_hash` plus `provider` and `external_id` columns so SSO and local users coexist in the same table. Two provider-agnostic endpoints live in `src/auth/sharedRoutes.ts` and are mounted alongside the active provider: `GET /api/auth/methods` (public discovery) and `GET /api/auth/me` (bearer → current user).
- **`src/app.ts` / `src/index.ts`** — composition root. Constructs storage, auth provider, broadcaster, then wires the Hono app, the `/api/ws` socket (`ws/appSocket.ts`), and the Yjs collaboration socket (`ws/yjsSocket.ts` + the generic `ws/yjsExtension.ts` Hocuspocus extension that delegates to `storage.yjs`).
- **Background work**: `lib/trashCleanup.ts` runs hourly and goes through `storage.maintenance.cleanupTrashedBefore()` rather than touching the DB directly, so it works for any storage driver.

## Testing

- Vitest with `@testing-library/preact`, browser mode via Playwright (Chromium, headless)
- Test files are colocated with source (e.g., `actions.test.ts` next to `actions.ts`)
- Tests use real `localStorage` — clear in `beforeEach`/`afterEach`
- Signal state is set directly in tests (e.g., `notes.value = []`)

## Code Style

- Biome for linting and formatting (not ESLint/Prettier)
- TypeScript strict mode in all packages
- `type: "module"` (ESM) throughout

## Rules

- Never use `git stash` for any purpose
