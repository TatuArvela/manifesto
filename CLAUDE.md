# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

Each is a short form of a rule whose reasoning lives in an area guide (see Area Guides below). They
are here because breaking one fails silently, often from a file the guide is not scoped to.

- Never use `git stash` for any purpose.
- No em dashes anywhere: docs, comments, UI strings, test names, commits, PRs (`pnpm lint` fails).
- Check `docs/specification/non-goals.md` before proposing a feature.
- A state action never rejects: it reports its own failure and returns `false` / `null`. A handler
  that does not await one marks it `void`. Group work goes through `asBatch`.
- A note the server sends comes in through `receiveNote` / `receiveNoteList`, never an assignment.
- Test `SERVER_URL` and `storageConnection.serverUrl` with `=== null`, never falsiness: `""` is a
  same-origin server, not open mode. Account-level requests go through `storage/apiRequest.ts`.
- The product name is `APP_NAME` (never a literal, never `__APP_NAME__`); catalogues use `{appName}`.
- Call `t()` inside render bodies, never at module scope. New strings go in `en.ts` first.
- Escape goes through `useEscapeStack`, single-key shortcuts through `useShortcut`; never bind your
  own `keydown` for either.
- A note image renders through `StoredImage`; anything that leaves the session inlines them.
- A new `Note` field goes in `SHARED_NOTE_FIELDS` or `PERSONAL_NOTE_FIELDS`, and an array field
  needs a case in `mergeNoteUpdate` (the default, client-wins, drops the other writer's items).
- Changing a node or mark in the editor schema means raising `EDITOR_SCHEMA_VERSION`.
- A reminder moves only through `advanceReminder`, `snapReminderToFuture`, `reminderAt` or
  `pickedReminder`, never by setting `time` alone.
- A new server route is an entry in `OPERATIONS` with `auth`, `limits` and (if token-reachable)
  `scope`; routers mount no auth or rate limit, and a switchable one declares `feature`.
- Ending a user's sessions goes through `endUserSessions`; a note broadcast through
  `sharing/noteEvents.ts`; taking a note away from someone through `sharing/accessChanges.ts`.
- A security-relevant action writes an `audit(...)` entry (action in `AUDIT_ACTIONS`, a message in
  both catalogues); one a stolen session could abuse also calls `requireConfirmation`.
- Server-side outbound requests to user-supplied addresses go through `safeFetch`, never `fetch`.
- Quantifiers stay bounded in anything reachable from a card render.
- When a change alters what an area guide says, update the guide in the same commit.

## Project Overview

Manifesto is a free, open-source note-taking app with a sticky note interface. It's MIT licensed. The full spec lives in `docs/specification/`,
and what it has decided against in `docs/specification/non-goals.md`: check there before proposing a feature.

Server env vars are documented in `docs/specification/server/deployment.md` and rebranding in
`docs/specification/custom-instances.md`. Both are the source of truth, so configure from there
rather than re-deriving from `src/config.ts`.

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

The client's browser project drives real Chromium, so a fresh clone needs the browser binary
once: `pnpm --filter @manifesto/client exec playwright install --with-deps chromium`. CI gates
on exactly `lint`, `typecheck`, `test`, then both builds.

Run for a single package with `pnpm --filter @manifesto/<client|server|shared> <script>`.

Run a single test file: `pnpm --filter @manifesto/client exec vitest run src/path/to/file.test.ts`
(the packages have no `vitest` script; `exec` reaches the binary). Add `--project node` or
`--project browser` to run just one of the client's two test projects.

## Architecture

pnpm monorepo with three packages, plus one build tool:

- **`packages/shared`**: types *and runtime values*: `NoteColor` / `NoteFont` are real enums and
  the image, page-size and recurrence limits are exported constants, so this package emits
  JavaScript and is not erasable. It has no npm dependencies of its own. Because the client and
  server resolve it through different export conditions, a value added here must be reachable
  from the build, not just the types. Both vitest configs alias `@manifesto/shared` to
  `../shared/src/index.ts`, so tests never exercise `dist`: only a real build plus run catches a
  value that typechecks and is `undefined` at runtime.
- **`packages/client`**: Preact + TypeScript SPA, built with Vite. Uses @preact/signals for state, Tailwind v4 (via `@tailwindcss/vite`, no config file) for styling, Vitest for tests.
- **`packages/server`**: Node.js + TypeScript, Hono. Storage and authentication are pluggable behind `StorageDriver` and `AuthProvider` interfaces. Two storage drivers ship: SQLite (`better-sqlite3`, default) and Postgres (`pg`). Two auth providers ship: local (argon2 + sessions, default) and OIDC. The client also works standalone with localStorage in open mode, so the server is optional.
- **`packages/build-version`**: build-time only, never shipped. Resolves the version a build
  reports (Settings footer, `/api/health`): `0.1.5` on the release commit, `0.1.5+14.bf5a6dd`
  after it. It counts from the last commit to touch `.release-please-manifest.json`, not from the
  tag, because the tag is created by the Release workflow while the Pages build of the same push
  is already running. It needs full history, so a checkout that builds must set `fetch-depth: 0`;
  a shallow one gets `0.1.5+<sha>` rather than a false release number. The Docker context has no
  `.git`, so `image-publish.yml` resolves it outside and passes `MANIFESTO_VERSION` in.

### Key Design Decisions

- **Local-first**: Client works fully offline using localStorage (open mode). Server connection is opt-in.
- **Managed mode**: Organizations can deploy as server-only (no local storage, auth required).
- **Storage adapters**: Client abstracts data access behind `StorageAdapter` interface: `LocalStorageAdapter` (default) or `RestApiAdapter` (server-connected). Factory in `storage/index.ts`.
- **ULIDs** for note IDs (not UUIDs): lexicographically sortable, timestamp-prefixed.
- **NoteColor** uses named enums (not hex) so themes can map colors differently for light/dark mode.

### Area Guides

The reasoning behind each area lives in `.claude/rules/`, one file per area. Each is scoped with
`paths:` frontmatter and loads on its own the first time a matching file is read, so opening the
code is enough. Read one by hand when planning a change before touching its files.

| Guide | Covers |
| - | - |
| `client-state.md` | `notesStore`, actions, pending writes, prefs, auth signals |
| `branding.md` | `APP_NAME`, logos, deployment meta tags, server URL and CSP |
| `i18n.md` | catalogues, `t()`, plurals |
| `routing.md` | paths, the router, Back closing sheets |
| `version-history.md` | versions in both modes |
| `editor.md` | Milkdown, the collaborative binding, lazy Yjs, schema version |
| `auto-notes.md` | the plugin sandbox |
| `realtime.md` | both sockets, resume, heartbeat, `If-Match` merge |
| `reminders.md` | page and service worker scheduling, recurrence |
| `import-export.md` | share links, public links, importers, the export zip |
| `notes-that-compute.md` | inline arithmetic, URL extraction |
| `link-previews.md` | preview cards, the SSRF boundary |
| `layout-and-loading.md` | masonry, drag to reorder, touch holds, splash, phone sheets |
| `pagination.md` | paged listings, image bytes on demand |
| `components.md` | Dropdown, confirmation, Escape, shortcuts, Back, modals |
| `api-contract.md` | `OPERATIONS`, protection, features, the compatibility policy |
| `accounts.md` | admins, sessions, tokens, confirmation, audit |
| `sharing.md` | shares between accounts, teams |
| `server.md` | storage drivers, auth providers, attachments, MCP, webhooks, jobs |

## Testing

- Vitest. The client's suite is split into two projects by filename: `*.browser.test.ts` runs in a
  real headless Chromium via Playwright, everything else runs in Node. A test takes the `.browser`
  name when it needs a DOM (real CSS, `localStorage`, history, an iframe, DOMPurify), which is what
  keeps the pure majority (parsers, mergers, schedulers, formatters) fast. The server's suite is
  Node-only.
- Test files are colocated with source (e.g., `actions.browser.test.ts` next to `actions.ts`)
- Helpers that only tests import live in `src/test/` in both packages, and the storage contract
  suites in `server/src/storage/contracts/`, which is what keeps all three out of the server build.
- Tests use real `localStorage`; clear in `beforeEach`/`afterEach`
- Signal state is set directly in tests (e.g., `notes.value = []`)
- A module that a test mocks with a factory calling `importOriginal` must not sit in an import cycle
  (`state/auth.ts` is mocked so). The original then imports the mocked module back while its factory
  is still running, and the browser project hangs with no error at all, only files that never report.

## Code Style

- Biome for linting and formatting (not ESLint/Prettier)
- Import direction between source folders is a lint rule: the `overrides` in `biome.json` give each
  folder a `noRestrictedImports` list of the folders it may not import, with the reason as the
  message. Client, bottom up: `utils/`; then `storage/` and `autoNotes/`; `state/` (whose
  `prefs.ts` alone `i18n/` may read), `realtime/`, `extensions/`; `hooks/`; `components/`. Server:
  `lib/` knows nothing of notes or accounts, `storage/` imports only `lib/`, and only `app.ts`
  imports `routes/`. Tests are exempt. A new folder needs a line in the list of its layer, or nothing
  keeps it in place. The patterns match relative specifiers, not resolved paths, so a folder with
  subfolders lists `../../x/**` beside `../x/**`.
- TypeScript strict mode in all packages
- `type: "module"` (ESM) throughout
- No em dashes (—) anywhere: docs, comments, UI strings, test names, commit messages and PR
  descriptions. Use whichever punctuation fits the sentence: a colon, a semicolon, a comma,
  parentheses, or a full stop. A term followed by its definition in a list is `**Term**: text`.
  `pnpm lint` fails on one (`lint:dashes`), and on any Biome warning, not only errors.
- A source file stops at 1000 lines (`noExcessiveLinesPerFile`; the catalogues and tests are
  exempt). Split along a seam rather than raising the limit.
- Several rules in this file are lint errors rather than prose, with their exceptions listed as
  overrides in `biome.json`: `fetch` in the client only in `storage/`,
  `state/auth.ts`, `state/publicLinks.ts` and `autoNotes/registry.ts`; `process.env` only in
  `config.ts` and `lib/logger.ts` (so `configDocs.test.ts` can hold `deployment.md` to every variable
  read); `console` only `error` and `warn`; no default exports outside `*.config.ts`; nothing but
  tests imports `src/test/`. `biome-plugins/` holds the two rules Biome has no built-in for:
  `endUserSessions.grit` and `noteEvents.grit`.
- `tsconfig.base.json` adds `verbatimModuleSyntax`, `noImplicitOverride`, `noImplicitReturns`,
  `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` to strict mode. The server builds from
  `tsconfig.build.json`, which leaves out tests, `storage/contracts/` and `src/test/`, so none of
  them ship in the image.
- `exactOptionalPropertyTypes` keeps "absent" and "present but `undefined`" apart. The wire types
  in `@manifesto/shared` stay `?: T`, since JSON cannot carry an `undefined`, so a request schema
  uses zod's `.exactOptional()` (and `exactPartial` in `validation/schemas.ts`), never `.optional()`
  or `.partial()`, which `validation/wireTypes.ts` would refuse. An internal option or a prop that
  callers pass through from somewhere optional is declared `?: T | undefined`.
- `noUncheckedIndexedAccess` types every `list[i]` and regex group as possibly `undefined`, and
  there are no `!` assertions to wave that away. Destructure with a default
  (`const [first = ""] = s.split(",")`), iterate with `entries()`, or read `.at(-1)` and test the
  result. In a test, `list[0]?.field` inside an `expect` is fine, but not with a negative matcher
  (`not.toBeNull()` passes on `undefined`) or where the value is passed on; there use `defined()`
  from `src/test/defined.ts`, which fails the test instead.
- `useExhaustiveDependencies` is on for the client's hooks, with unnecessary dependencies not
  reported: a signal read into a local (`const x = sig.value`) looks constant to Biome, but is
  exactly what an effect has to re-run on. A function an effect calls is made stable with
  `useCallback`, or read from a ref when its identity must not re-run the effect.
- `noFloatingPromises` (nursery) is on. Actions never reject, so a handler that does not await one
  marks it `void`.
