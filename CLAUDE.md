# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Manifesto is a free, open-source note-taking app with a sticky note interface. It's MIT licensed. The full spec lives in `docs/specification/`.

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
  from the build, not just the types. That mismatch once shipped a constant that typechecked
  green and was `undefined` at runtime. Both vitest configs alias `@manifesto/shared` to
  `../shared/src/index.ts`, so tests read the same files the compiler checked, which is why
  nothing caught it. Only a real build plus run exercises `dist`.
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

### Client State Management

State lives in `packages/client/src/state/` using @preact/signals:

- **`actions.ts`**: Core signals (`notes`, computed `filteredNotes`/`sortedNotes`/`allTags`), and async action functions (`createNote`, `updateNote`, `trashNote`, `bulkArchive`, etc.). Actions modify both signals and the storage adapter.
  **An action reports its own failure and resolves; it never rejects**, and says whether it worked
  in its return value (`false`, or `null` where a value was expected). The call sites are JSX
  handlers with nowhere to put a `catch`, so a rejection there is an unhandled rejection the user
  never sees. Group work goes through `asBatch`, which counts failures instead of letting each one
  raise its own toast and reports the total once.
  In connected mode a write is local-first: `updateNote` puts the change in the signal before it
  sends. Every copy of a note the server sends back (a reply, a broadcast, a listing) comes in
  through `receiveNote` / `foldIncomingList` and never through a plain assignment.
  `pendingWrites.ts` replays the writes still outstanding on top of that copy, so a late reply
  cannot revert a newer click. `settle` must get the same `changes` object `begin` did, even
  when a conflict retry sent a merged one. `incomingNote.ts` hands back the held note by
  reference when nothing changed. That keeps a client's own write, which it hears twice (as the
  reply and as the broadcast), and a reconnect's re-fetch from repainting the board or dropping
  image bytes a card already loaded. Grouped writes start together, each showing its change
  before it awaits anything.
- **`ui.ts`**: UI state signals (`editingNoteId`, `activeView`, `searchQuery`, `selectedNotes`).
- **`prefs.ts`**: User preferences persisted to `localStorage` key `manifesto:prefs` with debounced `effect()`.
- **`router.ts`**: Two-way sync between `activeView`/`activeTag` and `location.pathname` (see
  Routing below). `initRouter()` is called once from `App` on mount. The URL *fragment* is a
  separate channel used by share links and the OIDC callback, not by the router.
- **`auth.ts`**: Server-mode auth: `authToken` / `currentUser` signals persisted to `localStorage` key `manifesto:auth`. `login` / `register` POST to `/api/auth/*`. `LoginScreen` queries `/api/auth/methods` on mount and renders either the local form or a single "Continue with SSO" button (linking to `${SERVER_URL}/api/auth/login`) depending on the active provider. After an OIDC callback the server redirects to the client with `#token=...`; `consumeOidcRedirect()` runs once on `App` mount, fetches `/api/auth/me`, populates the signals, and strips the fragment from the URL.

### Branding

The product name is a deployment parameter, never a literal. `src/config.ts`
exports `APP_NAME` (plus `APP_FILE_SLUG` for download filenames and
`APP_LOGO_URL` for the header mark), resolved from the `application-name` meta
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

Three deployment parameters are read from `index.html` this way, not one:
`application-name`, `welcome-dialog`, and `manifesto-server` (`resolveServerUrl`,
feeding `SERVER_URL` / `isServerMode` in `state/auth.ts`). The last one is not
branding and carries a trap the other two do not. The server address and the CSP
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
guard on `SERVER_URL` tests `=== null` and never falsiness. Reading `""` as "no
server" is exactly the bug this had: `isServerMode` was true so `LoginScreen`
rendered, while `authRequest`, `currentStorage` and both socket builders took
the open-mode branch, giving a sign-in form that submitted into nothing and,
had a token ever arrived, notes written to `localStorage`. A relative base is
right for `fetch` and useless to a `WebSocket`, so `resolveServerOrigin` spells
it out from `window.location` once and `SERVER_ORIGIN` / `WS_ORIGIN` are what
the sockets and the "your notes are on <host>" copy read.

`VITE_APP_DESCRIPTION` fills `%APP_DESCRIPTION%` in `index.html` and the web
manifest. `VITE_APP_ICONS_DIR` overlays replacement icons onto the output, which
is why `logo.svg` lives in `public/` rather than `src/assets/`: brand marks
must stay plain files at fixed paths. `manifesto:` localStorage keys and the
`@manifesto/*` package names are internal and stay as they are.

### Internationalization

`src/i18n/` holds two catalogues, `messages/en.ts` and `messages/fi.ts`. English is the source
of truth for keys (`MessageKey = keyof typeof en`), so a new string lands in `en.ts` first and
the typecheck then demands it in `fi.ts`; tests enforce key parity, a `.other` form on every
Finnish plural, and that neither catalogue hard-codes the product name.

`t()` reads the `locale` signal internally, so **call it inside component render bodies**, never
at module scope, or the string freezes to the load-time locale. `plural()` picks the form via
`Intl.PluralRules` and defaults `{count}` to `n`. Units and separators come from `Intl` rather
than from messages (`formatFileSize` renders "MB" / "Mt"), so a translator never has to know the
local convention.

### Routing

`state/router.ts` syncs `activeView` / `activeTag` with `location.pathname` (base-prefixed from
Vite's `BASE_URL`). Eight views, eight paths: `/` → active, `/tags` and `/tags/<tag>` → tags,
`/reminders`, `/auto-notes`, `/archived`, `/trash`, `/search`, `/admin`. `/admin` renders only for an
admin in connected mode; `App` sends anyone else to `/` once `/me` has answered, not before, since the
persisted user can predate a grant. The `githubPagesSpaFallback` Vite
plugin copies `dist/index.html` to `dist/404.html` so GitHub Pages serves the SPA for any unknown
path.

### Version History

Notes have persistent version history. Versions are saved automatically when the editor closes with changes (capturing the pre-edit state), through the storage adapter (`state/versions.ts`): in connected mode the server keeps them (`note_versions`, `/api/notes/:id/versions`), and a browser's older local history for a note is sent across the first time it is opened. In open mode they are LZ-String compressed in `localStorage`, one key per note (`manifesto:versions:<id>`), so saving a version never re-compresses another note's history; the old shared `manifesto:versions` map is split on first use (`storage/VersionStorage.ts`). Capped at `MAX_NOTE_VERSIONS` per note and `NOTE_VERSION_MAX_AGE_DAYS` in both. UI: `components/VersionHistory.tsx`, accessed via kebab menu in the note editor.

### Editor

Markdown editing uses **Milkdown** (`@milkdown/kit`) with the CommonMark + GFM presets, plus the `history`, `clipboard`, and `listener` plugins. The editor instance is wired up in `hooks/useMilkdownEditor.ts` and rendered by `components/MilkdownEditor.tsx`. Undo/redo flows through Milkdown's history plugin (called via `callCommand(undoCommand)` / `redoCommand`); there is no separate undo/redo hook. Custom ProseMirror behavior lives in `packages/client/src/extensions/` (`manifestoInlineMarks` for inline marks, `taskItemDraggable` for drag-and-drop checklist items). Read-only previews are rendered by `utils/remarkRenderer.ts` (remark → rehype → sanitized HTML via DOMPurify).

`MilkdownEditor` reads markdown via `getMarkdown()` and post-processes it (`unescapeBrackets`, `collapseListSpread`) to keep round-trips stable with our preview.

The `listener` plugin serializes on a 200ms debounce it gives no way to cancel, and the timer
throws `Context "editorView" not found` if the editor is gone when it fires. `useMilkdownEditor`
takes a `beforeDestroy` callback for exactly this, and `MilkdownEditor` uses it to empty
`markdownUpdated`. The plugin checks that array's length before it serializes, so an empty one
makes the pending timer a no-op. Anything else added to the editor that outlives a frame needs
disarming there too; teardown is the only moment the context is still intact.

**Collaborative binding.** Once `collab` is supplied, the shared `Y.XmlFragment` is the authority
and the `content` prop must never be written into a fragment that already holds something: doing
so deletes another session's work on every device at once. Four pieces enforce that, and the
tests in `MilkdownEditor.browser.test.tsx` / `NoteCardEditor.browser.test.tsx` fail if any one is
removed: `NoteCardEditor` withholds `collab` until the provider reports `synced`, `NoteEditor` keys
the editor on `collab` so it rebuilds with the plugin installed, `MilkdownEditor` seeds the
fragment from the note *only* when it is empty, and it holds the editor unbuilt until
`loadYjsCollab()` resolves. Any effect with `editor` in its dep array also runs
at mount, after `ySyncPlugin` has rendered the shared document, so an effect that pushes local
content must first establish that it is reacting to a change and not to the editor's arrival.

The collaboration stack is loaded on demand and that is a correctness constraint, not only a size
one. `realtime/yjsSession.ts` holds every Yjs/Hocuspocus/y-indexeddb import and is reached only
through `import()` in `useNoteYDoc`; `extensions/yjsCollab.ts` fetches `y-prosemirror` through
`loadYjsCollab()`. The fetch must finish *before* `Editor.make()`, never inside the plugin's
runner: Milkdown reads `prosePluginsCtx` to build the view in the same pass, so a runner that
awaits anything before `ctx.update` installs `ySyncPlugin` after the view exists. The editor then
shows the local note instead of the shared document and writes that copy over everyone else's on
the next save. That is why `useMilkdownEditor` takes a `ready` flag. Open mode is the default
build and can never sync, so keeping these three chunks out of the entry is worth ~130 KB
minified to every user who will never use them.

### Auto-notes Plugin Sandbox

Auto-notes run user-supplied JavaScript, so it executes at three removes from the app and each
remove is load-bearing:

- `public/autonotes-sandbox.html` is loaded via `iframe.src` with `sandbox="allow-scripts"` and no
  `allow-same-origin`: an opaque origin, so no host storage, cookies or DOM. It can't be `srcdoc`:
  those inherit our `script-src 'self'`, while a frame from a real URL carries its own CSP.
- Inside the frame, the plugin runs in a blob `Worker` (hence `worker-src blob:` in that CSP). This
  is what makes the 2s timeout in `autoNotes/sandbox.ts` enforceable: a plugin that never returns
  occupies only the worker's thread. An engine that refuses a worker at an opaque origin gets a
  fallback to frame-thread execution, reported in `init-ok` and warned about by the host.
- The frame returns `JSON.stringify({ value })` and validates nothing; `autoNotes/results.ts`
  decides what is a note. Keep it that way, because a plugin that subverts the frame passes the frame's
  own checks.

### Realtime and Conflict Resolution

Server mode runs two sockets, and they carry different things. `realtime/appSocket.ts` holds
`/api/ws` (note events and presence) and reconnects with exponential backoff to a 30s ceiling.
Every reconnect *after the first* re-fetches the note list, because writes made on another device
while this tab was offline arrive nowhere else. `realtime/yjsProvider.ts` holds `/api/yjs`, one
`HocuspocusProvider` per open note, with `y-indexeddb` underneath so an offline edit survives a
reload. Its `synced` flag is a correctness gate, not a spinner; see Collaborative binding above.

Being resumed is a reason to skip the backoff. A frozen page comes back to a socket the browser
closed for it, and to a backoff its throttled retries may have grown to the ceiling, so a
`visibilitychange` back to visible (and an `online` event) dials at once and resets the backoff. It
dials for a socket in `CLOSED` as well as a missing one, because a resume can deliver the visibility
change before the queued close event, and for one that has gone silent. A socket that dies with no
close stays `OPEN` to both ends, so the server pings every `APP_SOCKET_HEARTBEAT_MS` and terminates
a peer that did not answer the last one, and sends a `heartbeat` event, since a page cannot see
pings. The client gives up on a socket after two and a half beats without a word, but only once it
has heard a heartbeat, so an older server's quiet socket is not redialled forever. The token effect
in `startAppSocket` runs its work `untracked`: `setStatus` reaches code that reads signals, and a
read there once made the outage timer tear the socket down every 4s. The user side of the same
moment is `realtime/connectionOutage.ts`: the banner reports `connectionOutage`, which is `connectionStatus` after a delay, never the status
itself, or every resume announces a reconnect that is already finishing. A deliberate teardown
(`disconnect`, so a logout or open mode) is `idle` rather than `closed` for that reason, and the
delay is armed once per outage, not once per status write, since `connecting` and `closed` alternate
all the way through one.

Non-collaborative writes use optimistic concurrency: `updateNote` sends `If-Match`, and a 412 comes
back carrying the current server row. `state/mergeNote.ts` then does a 3-way merge of
(base, desired, current) and retries once. Scalars are client-wins; `tags`, `images` and
`linkPreviews` merge per item, so two devices adding different tags keep both and a removal still
removes. Adding an array field to `Note` means teaching `mergeNoteUpdate` about it. The default is
client-wins, which for an array silently discards the other writer's additions.

### Reminders and the Service Worker

Reminders fire from two places and must not double-fire. `state/reminderScheduler.ts` runs timers
in the page; `sw.ts` holds its own copy of the reminder list in IndexedDB and fires via
`periodicSync` (falling back to a poll) so a reminder still arrives with the tab closed. The page
pushes the list down with `sync-reminders` and the worker reports back with `reminder-fired`, which
`serviceWorker.ts` turns into the `lastFiredAt` / next-occurrence write. Dedupe is a 60s window;
catch-up for a missed fire is one hour. `state/reminderTime.ts` owns recurrence maths
(`nextOccurrence`, `snapToFuture`) and is deliberately pure so it tests in the Node project.

### Sharing, Import and Export

`sharing.ts` encodes a note into the URL fragment (LZ-String over a five-field JSON payload),
so a share link needs no server and no account. The fragment is attacker-controlled, so
`decodeSharePayload` is a total type guard, not a cast: every field is checked, color and font
against the enums, and anything that fails returns `null` rather than a partly-trusted note. `App`
shows `SharedNoteDialog` when the fragment is present, and the recipient chooses whether to save.
The rendered preview still goes through `remarkRenderer`, which sanitizes.

`utils/importExport.ts` handles both directions for Markdown and JSON, single note and bulk. It
caps input at 50MB, because a multi-GB drop locks the tab inside `JSON.parse` before any of our
code runs. Export is one of the three callers that genuinely needs image bytes rather than
`imageCount`; see Pagination below.

### Notes That Compute

Two unrelated features make a note more than text, and both run on every render of a card:

- `utils/evaluateExpression.ts` is a hand-written tokenizer and shunting-yard parser for trailing
  arithmetic (`200+300` at the end of a line), wired in by `extensions/inlineCalculations.ts`. It
  is hand-written rather than `eval`-shaped on purpose, and it accepts the comma decimal separator.
- `utils/linkPreview.ts` extracts URLs for the preview cards. Its trailing-punctuation regex uses a
  *bounded* quantifier: the unbounded version backtracked quadratically and froze the tab on a long
  note, during render, with no user action beyond opening it. Keep quantifiers bounded in anything
  reachable from a card render.

### Link Previews

A pasted link gets a plain card at once (`appendStubPreviews`, all of a paste's URLs in *one*
write: building each from the same note kept only the last). `state/linkPreviews.ts` then asks
`storage.fetchLinkPreview`, which is always null in open mode, since its CSP forbids reaching a
third party. In connected mode the server fetches the page and returns the images raw;
`utils/previewImage.ts` redraws them through a canvas to fit 64 KB, because previews travel in
every listing and must render with the CSP's `img-src` unchanged.

On the server, `src/linkPreview/safeFetch.ts` is an SSRF boundary. It checks *every* resolved
address with `addressPolicy.ts` and connects to the checked one through a pinned `lookup`. Handing
the hostname to the HTTP client instead re-resolves it, which is a DNS rebinding hole. Redirects
must go back through the check. Tests reach a loopback server only through the explicit
`isAllowedAddress` / `allowAnyPort` seams.

### Layout and Loading

`hooks/useMasonryGrid.ts` does masonry with `grid-row` spans: release every card to its natural
height, measure, then write each span back. It runs from a `ResizeObserver`, so it only writes
spans that changed. A pass that changes nothing provokes no further callback, which is what keeps
it from looping. Only a change of the container's *width* releases the whole grid; a card that
resized is re-measured where it stands (items are `items-start`, so its span cannot change its
height), and the effect is keyed on the note ids, not the note list, so an auto-save does not set
the grid up again. Content that settles after first paint (images, fonts) has to trigger a re-measure
or the card keeps the height it was born with.

Drag-to-reorder is gated by the `canReorder` computed: Notes or Auto-notes view, default sort, no
search, no modal. `reorderNotes` gives the dropped note the midpoint between its neighbours and
writes nothing else. `position` is a float in both drivers, so a `POSITION_STEP` (1000) gap lasts
about fifty halvings before `renumberFrom` spreads everything out again. The neighbours are found
on the whole number line, archived and trashed notes included: they share it, and a slot chosen
among the visible notes alone can land on a hidden one. Ties in the manual sort break on `id`.

While a card is dragged, `ReorderableGrid` previews the new order: the card takes the place of the
card under the pointer, found by hit-testing where cards are drawn, and the others slide (FLIP)
to make room. The order is shown through each card's CSS `order`, never by moving DOM nodes,
because moving a node drops the pointer capture a touch drag holds. The dragged card keeps its
slot with `visibility: hidden`; the only copy on screen is under the pointer (the browser's drag
image, or `.note-drag-ghost` for a finger). The card just swapped with is passed over until the
pointer leaves it, or the two swap back and forth under a still pointer. A drop commits the order
on screen and never applies a move still waiting for its frame. `dragenter` is cancelled as well
as `dragover`: cards move under the pointer, and a drop onto a card entered with no `dragover`
since is refused by the browser.

On a touch screen that drag is reached only by holding the card first, and the ordering in
`hooks/useTouchGesture.ts` is what keeps the board scrollable: a finger that moves before the hold
has elapsed is scrolling, so the gesture abandons itself and the card is never picked up, dimmed or
selected on the way past. Releasing a hold that never moved is what enters select mode.
`.note-draggable` therefore carries `touch-action: pan-y`, not `none`. That alone would let the
browser start a pan on the first move *after* the hold and take the pointer stream with it, so a
held card cancels the scroll at its source: a non-passive `touchmove` listener that
`preventDefault`s from the moment the hold fires. `touch-action` cannot express "pannable until
held". `onHoldEnd` fires however a hold ends, including a `pointercancel` the system sends, or a
card the OS took the touch from would stay lifted with nothing holding it.

`index.html` carries a loading screen and a blocking `/theme-init.js` ahead of the bundle, because
both have to be on screen or applied before the bundle exists: launched from a home screen there is
no browser chrome to look at while it loads. `theme-init.js` duplicates the two reads `prefs.ts`
makes of `manifesto:prefs` and writes the same `dark` class; it is a separate file rather than an
inline script because the page's CSP allows scripts from `'self'` only. `main.tsx` removes the
splash a frame after the first render, on a timer as well as `transitionend`, since that event
never arrives in a background tab.

`storage/quota.ts` reports a browser storage refusal and nothing more: it holds no reference to the
toast queue or the catalogue, so the "tell the user" decision stays in `actions.ts`. A refused
write is neither retried nor rolled back: the signal keeps the change, so the session continues
with a note that exists only in this tab.

### Pagination

`/api/notes` and `/api/search` page with `?limit=&cursor=`, ordered by `(updatedAt, id)`, because two
notes saved in the same millisecond have no order by timestamp alone, and a page boundary between
them would repeat one and drop the other. A *listed* note carries `imageCount` and an empty
`images`; the bytes come from `GET /api/notes/:id`. The client drains every page, because
`allTags`, tag counts and the filter chain are computed over the whole list. Paging bounds a
response, it does not change the model. `useNoteImages` hangs `ensureImages` off an
`IntersectionObserver` so a grid fetches only what is scrolled past. Three callers need the bytes
and say so: the editor's add-an-image handler (which would otherwise write an empty list over every
existing attachment), the JSON export, and the `images` search filter. Open mode resolves the same
call locally, so both modes behave alike.

### Component Patterns

- **NoteEditor** is fully prop-driven (title, content, color, font, callbacks). Parent components (`NoteCardEditor`, `NoteInput`) own the state.
- **NoteCardEditor** wraps NoteEditor for editing existing notes and manages auto-save (500ms debounce) and version history. Undo/redo is delegated to Milkdown.
- **Dropdown** is the generic popover pattern (used for color picker, font picker, kebab menu) with
  `open`/`onClose`/`trigger`/`children` props. Its panel opens and closes on one CSS transition
  rather than two animations, so a menu re-opened mid-fade reverses instead of starting over, and
  `@starting-style` supplies the entry's other end. The popover is `manual`: the component
  dismisses it (outside press, Escape) and hides it only once the exit has played, since a browser
  that hides it at once takes it out of the top layer mid-fade and only Chromium can transition
  `overlay`. `leaving` is derived in render, never set by an effect: one frame of neither open nor
  leaving is `display: none`, which cancels the exit. Card popovers (`CardPopover`) are mounted
  only while open and get their exit from `usePresence`. The slide is a
  translation and never a scale, because the browsers without anchor positioning place the panel
  from a measured `getBoundingClientRect` and a scaled box measures smaller than it lands.
- **Confirming a deletion** goes through the `confirmRequest` signal in `state/confirm.ts`, which
  `ConfirmDialogHost` renders, one question at a time: a second question answers the first with
  "no" rather than stacking, so the promise behind a replaced prompt always settles and no caller
  is left half-done. `confirmDeletion` is the guard for a single note and respects the preference;
  bulk deletions call `askConfirmation` directly, since they take many notes whatever it says.
- **Escape** goes through `hooks/useEscapeStack.ts` and nowhere else; never bind a `keydown`
  listener for it. One document listener hands a press to the layer that became active last, so a
  new dismissable layer only has to call `useEscapeStack(active, close)`; binding your own brings
  back the bug where one press closed the picker *and* the editor under it. Ordering is by
  activation, not nesting (Preact runs a child's effects first), so a layer must not become active
  in the same render as one it sits inside. `Dropdown` closes its own panel rather than leaving it
  to the Popover API, because Chromium skips the light-dismiss when focus is inside ProseMirror.
- **Single-key shortcuts** go through `hooks/useShortcut.ts` and nowhere else, like Escape. The
  dispatcher, not the binding, decides when a key is not a shortcut (typing, an `aria-modal` layer or
  open popover, a modifier), so a new binding only calls `useShortcut(key, run)`. The board's keys and
  the `?` sheet read one list, `BOARD_SHORTCUTS` in `hooks/useBoardShortcuts.ts`.
- **`editingNoteId`** is the only thing that decides whether a card's modal is up. Closing means
  clearing the signal; `NoteCard`'s effect plays the animation and takes the modal down.

### API Contract

`packages/shared/src/api.ts` declares the wire types and `docs/specification/api.md` is the source of truth.
`GET /api/openapi.json` is generated from `src/openapi.ts`, whose request bodies are the validation
schemas; a new route must be added to `OPERATIONS` there, or `openapi.test.ts` fails.

- REST: `/api/notes` (with `/api/notes/:id/shares`), `/api/search`, `/api/invitations`, `/api/users`, `/api/auth/*` (auth routes are owned by the active auth provider)
- WebSockets: `/api/ws` (application events, presence) and `/api/yjs` (Hocuspocus collaboration: one socket for every note, the note id is the document name). `/api/ws` authenticates via `Sec-WebSocket-Protocol`; `/api/yjs` authenticates in the Hocuspocus `Auth` message and authorizes the right to edit the joined document (owner or `edit` recipient) in `onAuthenticate`.
- All timestamps are ISO 8601 UTC strings
- Note schema: see `docs/specification/data-model.md`

### Accounts and Admins

Connected mode has admins (spec: `docs/specification/features/accounts.md`). Three rules live in the
`users` repository rather than in routes, so both drivers enforce them and
`storage/adminContract.ts` tests each: the first account is the admin unless `isAdmin` says otherwise
(decided inside the `INSERT`), and `setAdmin` / `delete` never remove the last admin (a locked count,
not a read-then-write). Under local sign-in that first-account rule never fires in production:
`ensureInitialAdmin` (`auth/initialAdmin.ts`) creates `admin` with a printed temporary password before
the server listens. Never replace that with a fixed default; see the spec for why.

Anything that ends a user's sessions must go through `endUserSessions` (`auth/session.ts`), never
`sessions.deleteByUser` alone. Sockets authenticate once, at connect, so deleting rows leaves them
live; the helper also announces on `auth/revocations.ts`, and `ws/appSocket.ts` / `ws/yjsSocket.ts`
close what it covers. The Yjs side closes the raw socket, since closing one document's connection is
only a message the peer may ignore.

Personal API tokens (`mfp_`, `/api/tokens`) authenticate through the same `authenticateBySession`,
and `AuthIdentity.via` says which credential it was. Anything that changes how an account is secured
(tokens, password, email, the admin API) mounts `createAuthMiddleware(provider, { sessionOnly: true })`,
so a token handed to a script cannot take over its account. `endUserSessions` ends a user's tokens too;
revoking one token goes through `revokeApiToken`, which closes its sockets by the token's hash.

Security-relevant actions write an audit entry with `audit(storage, c, {...})` (`audit/audit.ts`),
fire-and-forget; a new one needs its action in `AUDIT_ACTIONS` (shared) and a message in both
catalogues, which `AuditLog.test.ts` checks.

A temporary password yields no session: login answers `403 password_change_required` until the same
request carries `newPassword`. The client never shows a server's `error` text, which is English:
`loginErrorKey` (`state/auth.ts`), `changePassword` and the admin actions (`state/admin.ts`) map
failures to catalogue messages by status. Account actions live in `AccountMenu` in the header, which
renders nothing in open mode; Settings has no account section.

### Sharing Between Accounts

Connected mode lets an owner share a note with other accounts, each as `edit` or `view`, once they
accept an invitation (spec: `docs/specification/features/sharing-with-people.md`). The note row is
the owner's; each recipient's `note_shares` row holds their role and their own `color`, `pinned`,
`archived`, `trashed`, `position`, `tags` and `reminder`. A recipient's trash is theirs alone and
expires their share, not the note; the owner's trash hides the note from everyone. `SHARED_NOTE_FIELDS` / `PERSONAL_NOTE_FIELDS` in
`@manifesto/shared` are the one list of which is which, read by the server's `splitChanges`
(`storage/shareMapping.ts`) and the client's `refusalFor` (`state/actions.ts`). Adding a field to
`Note` means putting it in one of them, or recipients cannot write it at all.

Every write by anyone stamps the note's `updated_at`, a recipient's pin included, so all participants
share one `If-Match` token and a listing merges own and shared notes in one `(updatedAt, id)` order.
Broadcast through `sharing/noteEvents.ts`, never `broadcaster.emit` with the writer's copy: each
participant sees different personal fields and a different `sharing.role`. Anything that takes a note
away from someone (removal, a role drop to `view`, the owner trashing it) also goes through
`sharing/accessChanges.ts`, for the same reason as `endUserSessions`: sockets authorized at connect
stay open otherwise. A viewer never joins `/api/yjs`; `onAuthenticate` refuses them.
`storage/sharingContract.ts` runs the rules against both drivers.

### Server Architecture

Two pluggable layers, both selected at boot via env vars (`STORAGE_DRIVER`, `AUTH_PROVIDER`):

- **`src/storage/`**: `StorageDriver` interface in `types.ts`. Bundles `users`, `sessions`, `notes`, `shares`, `yjs`, `maintenance` repos. Two drivers: `src/storage/sqlite/` (sync `better-sqlite3` wrapped in async-typed methods) and `src/storage/postgres/` (`pg` Pool, true-async). Schema parity is intentional. SQLite uses `INTEGER` booleans and `BLOB`s, Postgres uses native `BOOLEAN` and `BYTEA`, but the typed `Note`/`User`/etc. shapes returned to callers are identical. Tests for the Postgres driver run against `pg-mem`, so CI doesn't need a real Postgres. Storage construction is async (`await createStorage(cfg)`) since Postgres migrations require a query round-trip.
- **`src/auth/`**: `AuthProvider` interface in `types.ts`. Each provider exposes `authenticate(token)` for middleware/WS handshakes and owns its own `/api/auth/*` router. Two providers ship, and `AUTH_PROVIDER=both` mounts them side by side (`auth/index.ts`; ask
  `signsInLocally` / `signsInWithOidc` in `config.ts`, never compare `authProvider` to a name):
  `src/auth/local/` (username + argon2) and `src/auth/oidc/` (OAuth 2.0 Authorization Code + PKCE via `openid-client`, with JIT user provisioning by `(provider, sub)`). Both share `src/auth/session.ts` for session mint and bearer-token validation, so `authenticate()` is identical across providers, and the IdP only matters at login time. The `users` schema has nullable `password_hash` plus `provider` and `external_id` columns so SSO and local users coexist in the same table. Two provider-agnostic endpoints live in `src/auth/sharedRoutes.ts` and are mounted alongside the active provider: `GET /api/auth/methods` (public discovery) and `GET /api/auth/me` (bearer → current user).
- **`src/app.ts` / `src/index.ts`**: composition root. Constructs storage, auth provider, broadcaster, then wires the Hono app, the `/api/ws` socket (`ws/appSocket.ts`), and the Yjs collaboration socket (`ws/yjsSocket.ts` + the generic `ws/yjsExtension.ts` Hocuspocus extension that delegates to `storage.yjs`).
- **Attachments**: `Note.images` holds references in both modes: `local:<sha256>` in open mode (IndexedDB,
  `storage/localImages.ts`) and in connected mode `attachment:<id>` references to the
  `attachments` table, not bytes: the client uploads each to `POST /api/attachments` first, and note
  writes refuse anything but a reference (`claimImages` in `attachments/store.ts` makes each the note
  owner's, content-addressed per owner). The client draws them through `StoredImage` and inlines them again for anything that leaves the session (`inlineImages`). A new
  place that renders a note image must use `StoredImage`, and a new export path must inline.
- **Webhooks**: `webhooks/dispatcher.ts` subscribes to the broadcaster, so a webhook hears what its
  owner's sockets hear and a new note event needs no webhook code. Deliveries go through `safeFetch`
  (POST, no redirects) with the address rule `WEBHOOKS` picks; never call `fetch` for them.
- **Serving the client**: with `CLIENT_DIR` set (it is, in the image) `client/serveClient.ts` serves
  a built client at the root, mounted last in `app.ts` so every API route answers first; the image's
  client is built with `VITE_MANIFESTO_SERVER=/`.
- **Background work**: `lib/trashCleanup.ts` and `lib/sessionCleanup.ts` both run on `lib/periodic.ts`'s `startPeriodicJob`, once at startup, then hourly. Each goes through a repo method (`storage.maintenance.cleanupTrashedBefore()` and `cleanupTrashedSharesBefore()`, `storage.sessions.deleteExpired()`) rather than touching the DB directly, so both work for any storage driver.
- **Counting against a key**: `lib/expiringCounter.ts` is the one bounded map behind both throttles,
  `middleware/rateLimit.ts` (per address, per user) and `auth/local/loginAttempts.ts` (failed
  sign-ins per account name). Sweeping expired keys bounds the map only while they expire faster
  than a caller creates them, and the caller sets that rate, so the hard cap and its oldest-first
  eviction are the real bound. The invariant both halves rest on is that a window is *re-inserted*
  when it opens and never mutated in place: every key shares one `windowMs`, so insertion order is
  then expiry order, the sweep can stop at the first live key, and an eviction always takes the key
  closest to expiring anyway. Mutate a stale entry in place and the order drifts, the sweep breaks
  at the first key it meets, and eviction starts dropping live keys ahead of expired ones.
  The per-address key is a /64 for IPv6 (`ipBucketKey`), because one subscriber holds every address
  inside one and keying the /128 leaves nothing to throttle. IPv4 is keyed whole, and the
  `::ffff:a.b.c.d` form an IPv4 client takes on a dual-stack listener is unwrapped to that same key
  first, or every IPv4 client on the internet shares one bucket.

## Testing

- Vitest. The client's suite is split into two projects by filename: `*.browser.test.ts` runs in a
  real headless Chromium via Playwright, everything else runs in Node. A test takes the `.browser`
  name when it needs a DOM (real CSS, `localStorage`, history, an iframe, DOMPurify), which is what
  keeps the pure majority (parsers, mergers, schedulers, formatters) fast. The server's suite is
  Node-only.
- Test files are colocated with source (e.g., `actions.browser.test.ts` next to `actions.ts`)
- Tests use real `localStorage`; clear in `beforeEach`/`afterEach`
- Signal state is set directly in tests (e.g., `notes.value = []`)

## Code Style

- Biome for linting and formatting (not ESLint/Prettier)
- TypeScript strict mode in all packages
- `type: "module"` (ESM) throughout
- No em dashes (—) anywhere: docs, comments, UI strings, test names, commit messages and PR
  descriptions. Use whichever punctuation fits the sentence: a colon, a semicolon, a comma,
  parentheses, or a full stop. A term followed by its definition in a list is `**Term**: text`.

## Rules

- Never use `git stash` for any purpose
