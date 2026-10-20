# CLAUDE.md

This file gives guidance to Claude Code (claude.ai/code) for work on the code in this repository.

## Rules

Each rule is a short form of a rule whose reasons are in an area guide (see Area Guides below). The
rules are here because each one fails silently when you break it, frequently from a file that is not
in the scope of the guide.

- Never use `git stash` for any purpose.
- Use no em dashes in any place: docs, comments, UI strings, test names, commits, PRs (`pnpm lint`
  fails).
- Read `docs/specification/non-goals.md` before you propose a feature.
- A state action never rejects. It reports its own failure and returns `false` / `null`. A handler
  that does not await one marks it `void`. Group work goes through `asBatch`.
- A note that the server sends comes in through `receiveNote` / `receiveNoteList`, never through an
  assignment.
- Test `SERVER_URL` and `storageConnection.serverUrl` with `=== null`, never for falsiness. `""` is a
  same-origin server, not open mode. Account-level requests go through `storage/apiRequest.ts`.
- The product name is `APP_NAME` (never a literal, never `__APP_NAME__`). Catalogues use `{appName}`.
- Call `t()` inside render bodies, never at module scope. Put new strings in `en.ts` first.
- Escape goes through `useEscapeStack`, and single-key shortcuts through `useShortcut`. Never bind
  your own `keydown` for either.
- A note image renders through `StoredImage`. All data that goes out of the session inlines the
  images.
- All code that renders the content of an auto-note applies `drawnWithoutImages` / `withoutImages`
  (`utils/stripImages.ts`). A plugin that read notes has no other output than its cards.
- A new `Note` field goes in `SHARED_NOTE_FIELDS` or `PERSONAL_NOTE_FIELDS`. An array field needs a
  case in `mergeNoteUpdate` (the default, client-wins, deletes the items of the other writer).
- A change to a node or mark in the editor schema needs a higher `EDITOR_SCHEMA_VERSION`.
- A change to what the words of a note contain is a step appended to `NOTE_FORMAT_STEPS`, never an
  edit to a released step. A new place that keeps a note records its format with it.
- A reminder moves only through `advanceReminder`, `snapReminderToFuture`, `reminderAt` or
  `pickedReminder`, never when you set only `time`.
- A new server route is an entry in `OPERATIONS` with `auth`, `limits` and (if a token can reach it)
  `scope`. Routers mount no auth or rate limit. A route that a host can switch off declares `feature`.
- The end of the sessions of a user goes through `endUserSessions`. A note or invitation event goes
  through `sharing/noteEvents.ts`. When you take a note away from a person, use
  `sharing/accessChanges.ts`.
- A security-relevant action writes an `audit(...)` entry (an action in `AUDIT_ACTIONS`, a message in
  both catalogues). If a stolen session can abuse the action, it also calls `requireConfirmation`.
- Server-side outbound requests to addresses that users supply go through `safeFetch`, never through
  `fetch`.
- Encryption goes through `seal` / `unseal` with `associatedData`. The account key stays a `CryptoKey`
  that cannot be exported. No key that a person holds goes to the server.
- A value that the server stores to read by itself (a secret, the time of a reminder) goes through
  `atRest`, and its column goes into `AT_REST_COLUMNS`. If not, a replacement of the server key loses
  it.
- The words of a note go to the server only through the `Sealer` (`storage/sealing.ts`), sealed. Add a
  new field of them in `shared/src/crypto/noteSeal.ts` and in the sealed schema together.
- Quantifiers stay bounded in all code that a card render can reach.
- Commit messages follow the `commit-message` skill. PR descriptions follow the `pr-description`
  skill.
- When a change makes the text of an area guide incorrect, update the guide in the same commit. When
  you add a new file that a guide describes, add it to the `paths:` of the guide. If not, the guide
  never loads for that file.

## Project Overview

Manifesto is a free, open-source app for notes, with an interface of sticky notes. It has the MIT
license. The full specification is in `docs/specification/`. What it decided not to do is in
`docs/specification/non-goals.md`. Read that file before you propose a feature.

`docs/specification/server/deployment.md` documents the server env vars, and
`docs/specification/custom-instances.md` documents rebranding. Both are the source of truth. Thus,
configure from them, and do not derive the values again from `src/config.ts`.

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

The browser project of the client uses real Chromium. Thus, a new clone needs the browser binary one
time: `pnpm --filter @manifesto/client exec playwright install --with-deps chromium`. CI gates on
exactly `lint`, `typecheck`, `test`, and then both builds. For a PR, it also gates on its title and
commit subjects (`scripts/check-titles.mjs`, which `pnpm install` also installs as the `commit-msg`
hook).

To run a script for one package: `pnpm --filter @manifesto/<client|server|shared> <script>`.

To run one test file: `pnpm --filter @manifesto/client exec vitest run src/path/to/file.test.ts`
(the packages have no `vitest` script; `exec` reaches the binary). Add `--project node` or
`--project browser` to run only one of the two test projects of the client.

## Architecture

A pnpm monorepo with three packages, and one build tool:

- **`packages/shared`**: types *and runtime values*. `NoteColor` / `NoteFont` are real enums, and the
  limits for images, page size and recurrence are exported constants. Thus, this package emits
  JavaScript, and is not erasable. It has no npm dependencies of its own.
  - The client and the server resolve it through different export conditions. Thus, the build must
    reach a value that you add here, not only the types.
  - Both vitest configs alias `@manifesto/shared` to `../shared/src/index.ts`. Thus, tests never use
    `dist`. Only a real build and run finds a value that typechecks but is `undefined` at runtime.
- **`packages/client`**: a Preact and TypeScript SPA, built with Vite. It uses @preact/signals for
  state, Tailwind v4 (through `@tailwindcss/vite`, no config file) for styles, and Vitest for tests.
- **`packages/server`**: Node.js and TypeScript, Hono. Storage and authentication are pluggable behind
  the `StorageDriver` and `AuthProvider` interfaces. There are two storage drivers: SQLite
  (`better-sqlite3`, default) and Postgres (`pg`). There are two auth providers: local (argon2 and
  sessions, default) and OIDC. The client also works alone with localStorage in open mode. Thus, the
  server is optional.
- **`packages/build-version`**: only for the build, never shipped. It calculates the version that a
  build reports (the Settings footer, `/api/v1/health`): `0.1.5` on the release commit,
  `0.1.5+14.bf5a6dd` after it.
  - It counts from the last commit that changed `.release-please-manifest.json`, not from the tag. The
    Release workflow makes the tag while the Pages build of the same push already runs.
  - It needs the full history. Thus, a checkout that builds must set `fetch-depth: 0`. A shallow
    checkout gets `0.1.5+<sha>`, not a false release number.
  - The Docker context has no `.git`. Thus, `image-publish.yml` calculates it outside, and sends
    `MANIFESTO_VERSION` in.

### Key Design Decisions

- **Local-first**: the client works fully offline with localStorage (open mode). The connection to a
  server is optional.
- **Managed mode**: organizations can deploy it as server-only (no local storage, authentication
  required).
- **Storage adapters**: the client uses the `StorageAdapter` interface for data access:
  `LocalStorageAdapter` (default) or `RestApiAdapter` (connected to a server). The factory is in
  `storage/index.ts`.
- **ULIDs** for note IDs (not UUIDs): they sort lexicographically, and start with a timestamp.
- **NoteColor** uses named enums (not hex). Thus, themes can give colors differently in light mode and
  dark mode.

### Area Guides

The reasons for each area are in `.claude/rules/`, one file for each area. Each file has a scope in
its `paths:` frontmatter. It loads automatically the first time that you read a matching file. Thus,
to open the code is sufficient. When you plan a change, read the guide manually before you change its
files.

| Guide | Covers |
| - | - |
| `client-state.md` | `notesStore`, actions, pending writes, prefs, auth signals |
| `branding.md` | `APP_NAME`, logos, deployment meta tags, server URL and CSP |
| `i18n.md` | catalogues, `t()`, plurals |
| `routing.md` | paths, the router, Back that closes sheets |
| `version-history.md` | versions in both modes |
| `note-format.md` | the format of the words of a note, upgrade on read, refusal of a newer format |
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
| `encryption.md` | account keys, unlocking, the recovery key, sealed notes and their tests |
| `sharing.md` | shares between accounts, teams |
| `server.md` | storage drivers, auth providers, attachments, MCP, webhooks, jobs |

## Testing

- Vitest. The suite of the client has two projects, selected by filename. `*.browser.test.ts` runs in
  a real headless Chromium through Playwright. All other files run in Node. A test gets the
  `.browser` name when it needs a DOM (real CSS, `localStorage`, history, an iframe, DOMPurify). This
  keeps the pure majority (parsers, mergers, schedulers, formatters) fast. The suite of the server
  runs only in Node.
- Test files are next to their source (for example, `actions.browser.test.ts` next to `actions.ts`).
- Helpers that only tests import are in `src/test/` in both packages. The storage contract suites are
  in `server/src/storage/contracts/`. This keeps all three out of the server build.
- Tests use real `localStorage`. Clear it in `beforeEach`/`afterEach`.
- Tests set signal state directly (for example, `notes.value = []`).
- A module that a test mocks with a factory that calls `importOriginal` must not be in an import cycle
  (`state/account/auth.ts` is mocked in this way). If it is, the original imports the mocked module
  back while its factory still runs. The browser project then stops with no error. Only files that
  never report show the problem.

## Code Style

- Biome for linting and formatting (not ESLint/Prettier).
- The import direction between source folders is a lint rule.
  - The `overrides` in `biome.json` give each folder a `noRestrictedImports` list of the folders that
    it must not import, with the reason as the message.
  - Client, from the bottom up: `utils/`; then `storage/` and `autoNotes/`; `state/` (`i18n/` can
    read only its `prefs.ts`), `realtime/`, `extensions/`; `hooks/`; `components/`.
  - Server: `lib/` knows nothing about notes or accounts, `storage/` imports only `lib/`, and only
    `app.ts` imports `routes/`.
  - Tests are exempt. A new folder needs a line in the list of its layer. If not, nothing keeps it in
    its place.
  - The patterns match specifiers as they are written, not resolved paths. Thus, an import that goes
    out of its folder goes through `#/` (the `imports` of each package map onto its own `src/`).
    `biome-plugins/noParentImports.grit` refuses a `../` import. A `./` import stays inside its
    folder.
  - In server and shared, the map sends `#/` to `dist/` unless the `manifesto-source` condition is
    set. `tsconfig.base.json`, both Vite configs and `pnpm dev` set it. A built server that runs with
    plain `node` does not.
- An import names the file as it is (`./RestApiAdapter.ts`, `#/components/Note.tsx`).
  `useImportExtensions` enforces this. `rewriteRelativeImportExtensions` changes a `./` import into
  `.js` in the output of `tsc`, and does not change `#/`. Thus, server and shared map `#/*.ts` onto
  `dist/*.js`. The client, which Vite bundles, turns the rewrite off, because `tsc` refuses `#/x.ts`
  with it.
- TypeScript strict mode in all packages.
- `type: "module"` (ESM) in all packages.
- No em dashes (—) in any place: docs, comments, UI strings, test names, commit messages and PR
  descriptions. Use the punctuation that is correct for the sentence: a colon, a semicolon, a comma,
  parentheses, or a full stop. A term followed by its definition in a list is `**Term**: text`.
  `pnpm lint` fails on an em dash (`lint:dashes`), and on all Biome warnings, not only errors.
- A source file has a maximum of 1000 lines (`noExcessiveLinesPerFile`; the catalogues and tests are
  exempt). Split it along a seam. Do not make the limit higher.
- Some rules in this file are lint errors, not only text. `biome.json` lists their exceptions as
  overrides:
  - `fetch` in the client only in `storage/`, `state/account/auth.ts`, `state/publicLinks.ts` and
    `autoNotes/registry.ts`.
  - `process.env` only in `config.ts` and `lib/logger.ts`. Thus, `configDocs.test.ts` can check that
    `deployment.md` names each variable that the server reads.
  - `console` only `error` and `warn`.
  - No default exports outside `*.config.ts`.
  - Only tests import `src/test/`.
  - `biome-plugins/` contains the two rules for which Biome has no built-in rule:
    `endUserSessions.grit` and `noteEvents.grit`.
- `tsconfig.base.json` adds `verbatimModuleSyntax`, `noImplicitOverride`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and
  `noUncheckedSideEffectImports` to strict mode. The server builds from `tsconfig.build.json`, which
  excludes tests, `storage/contracts/` and `src/test/`. Thus, none of them are in the image.
- `exactOptionalPropertyTypes` keeps "absent" and "present but `undefined`" separate.
  - The wire types in `@manifesto/shared` stay `?: T`, because JSON cannot contain an `undefined`.
  - Thus, a request schema uses `.exactOptional()` of zod (and `exactPartial` in
    `validation/fields.ts`), never `.optional()` or `.partial()`. `validation/wireTypes.ts` refuses
    those.
  - Declare an internal option, or a prop that callers send through from an optional source, as
    `?: T | undefined`.
- `noUncheckedIndexedAccess` types each `list[i]` and each regex group as possibly `undefined`. There
  are no `!` assertions to remove that.
  - Destructure with a default (`const [first = ""] = s.split(",")`), iterate with `entries()`, or
    read `.at(-1)` and test the result.
  - In a test, `list[0]?.field` inside an `expect` is acceptable. But do not use it with a negative
    matcher (`not.toBeNull()` passes on `undefined`), or where the value goes to other code. There,
    use `defined()` from `src/test/defined.ts`, which makes the test fail.
- `useExhaustiveDependencies` is on for the hooks of the client. It does not report unnecessary
  dependencies. A signal read into a local (`const x = sig.value`) looks constant to Biome, but an
  effect must run again on exactly that value. Make a function that an effect calls stable with
  `useCallback`, or read it from a ref when its identity must not run the effect again.
- `noFloatingPromises` (nursery) is on. Actions never reject. Thus, a handler that does not await one
  marks it `void`.
