# Client

The Manifesto client is a static single-page application, built with Preact and TypeScript. It is
local-first: all features work offline with `localStorage`. You need a server only for sync between
devices.

## Tech Stack

| Technology                                                         | Purpose                                |
|--------------------------------------------------------------------|----------------------------------------|
| Preact + `@preact/signals`                                         | UI framework and reactive state        |
| Vite + `@preact/preset-vite`                                       | Build tool and dev server              |
| TypeScript (strict)                                                | Language                               |
| Tailwind CSS v4 (via `@tailwindcss/vite`)                          | Styling: CSS-first, no config file    |
| Milkdown (`@milkdown/kit`)                                         | Markdown editor (CommonMark + GFM)     |
| remark / rehype / unified                                          | Read-only markdown → HTML for previews |
| DOMPurify                                                          | HTML sanitization for rendered preview |
| lucide-preact                                                      | Icon library                           |
| ulid                                                               | Lexicographically sortable note IDs    |
| lz-string                                                          | Compression for sharing + versions     |
| clsx                                                               | Conditional class name merging         |
| vite-plugin-pwa + workbox                                          | Service worker / installable PWA       |
| Vitest: Node project, plus `@vitest/browser` on Playwright Chromium for `*.browser.test.ts` | Testing        |

### Why Preact

- Its API is compatible with React. Thus, React developers can contribute immediately.
- Its runtime is approximately 3 KB. Thus, it loads quickly, especially for self-hosted use and PWA
  use.
- Its own Signals library removes the need for external state management.
- It is sufficient for a notes app. The app does not need the concurrent features of React.

### Why Tailwind v4

- Utility classes go directly in the markup. This makes development fast.
- The configuration is in CSS, through `@theme` in `styles/setup.css` (which `styles.css` imports).
  There is no `tailwind.config.ts`.
- Dark mode is built in, through the `dark:` variant.
- The production build purges unused CSS. It contains only the CSS that the app uses.

## Source Layout

```
packages/client/src/
├── main.tsx              # Entry: mounts <App />, registers service worker
├── styles.css            # Tailwind v4 entry: imports the partials in styles/, in cascade order
├── styles/               # The stylesheet by subject (@theme tokens in setup.css)
├── colors.ts             # NoteColor → Tailwind class maps (light + dark)
├── autoNotes/            # The auto-note plugin sandbox, its registry and standard library
├── components/           # All UI components (see Component Hierarchy below)
│   ├── admin/            # AdminView and its pages (overview, teams, audit log)
│   ├── login/            # LoginScreen and its forms, and the screen and sheet for an account's keys
│   └── settings/         # SettingsDialog, one file per tab, and the rows and selects they share
├── extensions/           # ProseMirror/Milkdown extensions
├── hooks/                # Preact hooks (the editor, Escape, shortcuts, Back, masonry, gestures)
├── i18n/                 # Translation framework + en/fi message bundles
├── realtime/             # The app socket, the collaborative document and its sealing
├── state/                # Signals, actions, preferences, reminder scheduler
├── storage/              # StorageAdapter interface + Local/Rest implementations
├── test/                 # Helpers only tests import, and the browser project's setup file
├── utils/                # importExport, linkPreview, shareLink, markdown helpers, remarkRenderer
├── serviceWorker.ts      # PWA registration glue
└── sw.ts                 # Service worker source (Workbox precache + runtime)
```

## Architecture

### Component Hierarchy

```
App
├── Header
│   ├── Search input
│   ├── ViewMenu           (grid/list, card shape and size)
│   ├── SortMenu           (default / updated / created)
│   ├── Settings button
│   └── SelectionToolbar   (laid over the header while notes are selected)
├── Sidebar (desktop rail + MobileNav horizontal bar)
│   ├── Notes
│   ├── Tags (→ TagsView)
│   ├── Reminders
│   ├── Archive
│   └── Trash
├── NoteInput              ("Take a note…" bar)
├── InvitationList         (notes offered by other accounts, Notes view, connected mode)
├── TagsView               (tag tree with counts)
├── NoteGrid
│   └── NoteCard[]         (pinned + unpinned sections, drag-to-reorder)
├── NoteCardEditor         (modal overlay over a note)
│   └── NoteEditor
│       ├── MilkdownEditor      (markdown editing)
│       ├── FormattingToolbar   (bold, italic, headings, lists, etc.)
│       ├── ContentPreview      (read-only render, also used inside NoteCard)
│       ├── ImageGallery
│       ├── LinkPreviewHero / LinkPreviewList
│       ├── TagPicker
│       ├── ReminderPicker
│       ├── Dropdown            (color picker, font picker, kebab menu)
│       └── VersionHistory      (opened from kebab menu)
├── SharedNoteDialog       (when a share URL hash is present)
├── ShareDialogHost        (who has a note: invite, roles, remove, leave; connected mode)
├── SettingsDialog         (components/settings/: one file per tab, the account's pages included)
├── ReminderBanner         (fires when a reminder is due)
└── Toasts                 (success + error notifications)
```

Shared primitives: `Dropdown`, `Popover`, `Tooltip`, `ToggleSwitch`.

### State Management

The state is in `packages/client/src/state/`. It is reactive through `@preact/signals`.

- **`notesStore.ts`**: the `notes` signal, and all code that sends it to the storage (`loadNotes`,
  `createNote`, `updateNote`, `deleteNote`, `importNotes`, `ensureImages`, `expireTrash`). Each copy
  of a note that the storage sends back comes in through `receiveNote` / `receiveNoteList`. A note
  goes out through `forgetNote`.
- **`actions.ts`**: the user-level actions on the store: trash, archive, restore and pin with their
  exit animations, tags, bulk operations on the selection, `reorderNotes`, and checklist toggles.
- **`views.ts`**: what the current view shows: `filteredNotes`, `sortedNotes`, `pinnedNotes` /
  `unpinnedNotes`, `allTags`, `tagCounts`, `canReorder`.
- **`selection.ts`**, **`ordering.ts`** (pure position arithmetic), **`exportNotes.ts`**, and
  **`failures.ts`** (`reportFailure` and `asBatch`: how actions report without a rejection).
- **`ui.ts`**: temporary UI state: `activeView`, `activeTag`, `editingNoteId`, `searchQuery`,
  `selectMode`, `selectedNotes`, `showSettings`. It also has the toast queue (`toasts`, `showError`,
  `showSuccess`, `dismissToast`, `holdToasts`). An error stays until you dismiss it. A success goes
  away after five seconds, unless the pointer is on the stack or the stack has focus.
- **`prefs.ts`**: user preferences, kept in `localStorage` under `manifesto:prefs` through a debounced
  `effect()`. It contains `viewMode`, `noteSize`, `noteScale`, `sortMode`, `theme`, `lightHue`,
  `darkHue`, `defaultNoteColor`, `defaultNoteFont`, `noteQuips`, `formattingToolbar`, `stickyTopBar`,
  `defaultEditMode`, `noteCorners`, `animations`, `boardColor`, `boardCustomColor`, `boardGradient`,
  `boardGradientCustomColor`, `boardGradientDirection`, `boardTexture`, `boardInk`, `boardInkColor`,
  `boardTextureOpacity`, `boardUsePicture`, `boardImageStamp`, `inlineCalculations`,
  `decimalSeparator`, and `locale`.
  - In connected mode, the preferences that are not in `DEVICE_PREFS` go with the account through
    `prefsSync.ts`. It reads the copy of the server at sign-in and on reconnect, sends each change
    from here as a patch, and adopts `prefs:updated` from the app socket
    ([Preferences](../features/preferences.md)).
  - It also controls how those preferences show. It toggles the `dark` class on `<html>`, and listens
    for changes of the system preference. It sets the `notes-rounded` and `no-motion` classes. It sets
    the `data-light-hue` and `data-dark-hue` attributes, from which the stylesheet makes the neutral
    ramp of each theme (the light one also tints `--color-white`).
  - It sets the attributes that make the board: `data-board-color`, `data-board-gradient`,
    `data-board-gradient-direction`, `data-board-texture` and `data-board-ink`. It also sets
    `--board-custom`, `--board-gradient-custom`, `--board-ink-picked`, `--board-texture-opacity`,
    and the SVG patterns that `utils/boardTextures.ts` draws one time at load, as masks.
  - The custom colors must be six-digit hex colors, because the app writes them into CSS custom
    properties.
- **`board.ts`**: the board picture. It is in IndexedDB (`storage/boardImage.ts`), not in the
  preferences. A change of `boardImageStamp` tells a different tab to load it again.
- **`sharing.ts`**: notes shared between accounts in connected mode.
  - It contains the `invitations` signal and `shareDialog` (the note whose people show on the
    screen), and the actions to invite, change a role, remove, leave, accept and decline.
  - As `admin.ts` does, it changes failures into catalogue messages by status.
  - Before `updateNote` in `notesStore.ts` sends a change, it asks the same question as the server.
    It refuses a change to the note itself by a viewer, or a change by a recipient to a field that
    only the owner controls. It shows a sentence, not a `403`.
  - The note of a viewer opens in `NoteReadonlyView`, whose boxes you cannot tick. It never joins
    `/api/v1/yjs`.
- **`reminderScheduler.ts`**: a timer loop that fires `reminder:open-note` events when a reminder is
  due.
- **`router.ts`**: keeps `activeView` / `activeTag` and the URL path the same, in both directions
  (see [Routing](#routing)).
- **`index.ts`**: the barrel export of the public state API.

### Storage Adapters

The client uses a `StorageAdapter` interface (`storage/StorageAdapter.ts`) for persistence. It
declares `getAll`, `get`, `create`, `update`, `delete`, `deleteAll`, `importAll`, `loadImages`, and
the image, version and link-preview methods.

- **`LocalStorageAdapter`** (default): stores notes as JSON in `localStorage` under
  `manifesto:notes`. It makes ULIDs. When it reads old records, it adds defaults for newer fields
  (font, images, link previews, reminder). The limit is approximately 5–10 MB, on one device.
- **`RestApiAdapter`**: connects to a Manifesto server over the REST API. `getAll` follows
  `nextCursor` until the server stops to send one. Thus, the caller still gets all notes. Paging sets
  a limit on one response. The app keeps the full list in memory, because it calculates tag counts,
  filters and search from it.

`loadImages` is the seam for attachments, which a server listing does not include (see
[API](../api.md#attachments-are-not-in-a-listing)). Callers use `ensureImages(id)` in
`state/notesStore.ts`. It gets the images one time for each note, adds the result to the `notes`
signal, and shares one request between callers that ask at the same time.
`hooks/useNoteImages.ts` calls it from an `IntersectionObserver`. Thus, a grid downloads the
pictures of the cards that a reader scrolls past, not of all notes. In open mode, nothing was ever
separate. Thus, it resolves without a round trip.

`currentStorage` in `storage/index.ts` decides which adapter is live. It is a computed over the
`storageConnection` signal, which `state/account/auth.ts` writes. A server URL and a token select
`RestApiAdapter`. All other values select `LocalStorageAdapter`. The session pushes the connection
in, and storage does not read it out. Thus, the storage, which is below the session, does not import
the state of the session (see [Deployment](deployment.md)).

### Editor

Markdown editing uses **Milkdown** (`@milkdown/kit`) with the CommonMark and GFM presets, and the
`history`, `clipboard` and `listener` plugins. `hooks/useMilkdownEditor.ts` makes the editor, and
`components/editor/MilkdownEditor.tsx` renders it. Undo and redo go through the history plugin of
Milkdown (`callCommand(undoCommand)` / `redoCommand`). There is no separate undo/redo hook.

Custom ProseMirror behavior is in `packages/client/src/extensions/`:

- **`manifestoInlineMarks`**: adds underline, subscript and superscript marks. In markdown, they are
  `<u>`/`<sub>`/`<sup>` tags.
- **`taskItemDraggable`**: drag-and-drop reorder, and indent/outdent, for checklist items. The drag
  is in `taskItemDrag.ts`. `taskItemDropTarget.ts` calculates where a drop goes. The list structure is
  in `taskListStructure.ts`.
- **`richFormatting`**: finds which formats the selection has, and applies a format, for the
  formatting toolbar. `utils/rawFormatting.ts` does the same for the textarea of raw mode.

`utils/remarkRenderer.ts` renders the read-only previews (inside `NoteCard` and the shared-note
dialogs). It is a `unified` pipeline: `remark-parse` → `remark-gfm` → `remark-breaks` →
`remark-rehype` → `rehype-stringify`. DOMPurify sanitizes the output before the app inserts it.

`MilkdownEditor` reads the markdown back through `getMarkdown()`. Then it changes the result
(`normalizeMarkdown` in `utils/editorMarkdown.ts`: `unescapeBrackets`, `collapseListSpread`). This
keeps round trips stable with the preview renderer.

### Version History

Notes have a persistent version history, compressed with LZ-String, in `localStorage` under
`manifesto:versions`. The app saves a version automatically when the editor closes with changes. The
version holds the state from before the edit. The maximum is 50 for each note, and the app prunes
versions after 90 days. Storage: `storage/VersionStorage.ts`. UI: `components/VersionHistory.tsx`.
Open it from the kebab menu in the note editor.

### Auto-notes plugin sandbox

JavaScript that the user supplies makes the auto-notes. Thus, the code runs at three levels of
isolation from the app. See [Auto-notes](../features/auto-notes.md) for the plugin contract, the
limits and the data model.

- **An opaque origin.** `public/autonotes-sandbox.html` loads through `iframe.src` with
  `sandbox="allow-scripts"` and no `allow-same-origin`. Thus, it cannot reach host storage, cookies or
  DOM. It cannot be a `srcdoc` iframe, because such a frame gets the CSP of the parent, and the app
  pins `script-src 'self'`. A frame from a real URL has its own policy: `default-src 'none';
  script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'`.
- **A worker thread.** Inside that frame, the plugin runs in a blob `Worker`, which gets the origin
  and the CSP of the frame. This makes the 2s timeout of the host possible. A plugin that never
  returns uses only the thread of the worker. Thus, the timer of the host still fires, and the removal
  of the frame also stops the worker. If an engine does not permit a worker at an opaque origin, the
  frame runs plugins on its own thread, and tells this in the `init-ok` message. The host logs a
  warning, because on that path a `while (true)` stops the tab.
- **Validation on the host side.** The frame returns `JSON.stringify({ value })` of the return value
  of the exported functions of the plugin. `autoNotes/results.ts` decides what is a note. No code in
  the frame validates its own output, because a plugin that took control of the frame also passes its
  checks. The host checks the color and the font against `NoteColor` / `NoteFont`, because they are
  keys of `noteColorMap` and `noteFontFamilies`. An unknown string there throws while a card renders.
  The host removes a bad optional field, and does not fail the run. The number of notes for each run
  has a limit.

`autoNotes/sandbox.ts` controls the lifecycle of the frame and the timeout. `stdlib.ts` builds the
prelude of the worker (each stdlib function goes as source through `Function.prototype.toString`). A
plugin failure shows as `lastError` on the plugin, and as a visible ⚠ note.

### Reminders

Each note has an optional `reminder` timestamp, which you set through `ReminderPicker`.
`state/reminderScheduler.ts` subscribes to the `notes` signal, and uses timers to fire at the
scheduled time. When a reminder fires, it shows `ReminderBanner` and sends a `reminder:open-note`
window event. `App` listens for this event (`useNoteFromReminder`), and opens the note.

### Routing

`location.pathname` controls the navigation between views. Thus, you can bookmark views, and the
back and forward buttons of the browser work. `state/router.ts` keeps `activeView` and `activeTag`
the same as the URL. The URL has the prefix from the `BASE_URL` of Vite (`/` in dev, `/manifesto/` on
GitHub Pages):

| Path (under base)          | View                   |
|----------------------------|------------------------|
| `/`                        | Notes (active)         |
| `/tags`                    | Tags: all             |
| `/tags/<tag>`              | Tags: filtered by tag. A nested tag is a path (`/tags/work/clients`), with each part encoded |
| `/reminders`               | Reminders              |
| `/archived`                | Archive                |
| `/trash`                   | Trash                  |

`App` calls `initRouter()` one time when it mounts (`useAppServices`). It fills the signals from the
current URL. Then it installs an effect from the signals to the URL (`history.pushState`), and a
`popstate` listener from the URL to the signals. Share hashes (`#share=…`) are on top of the path.
`SharedNoteDialog` reads them separately.

GitHub Pages is a static host. Thus, a refresh of a deep link gives a 404. The
`githubPagesSpaFallback` plugin in `vite.config.ts` copies the built `index.html` to `404.html` after
each build. GitHub Pages serves that file for all unknown paths. Thus, the SPA loads, and the router
reads `location.pathname`.

### Sharing

`utils/shareLink.ts` encodes a note payload into a compact URL hash (`#share=…`), with LZ-String
compression. When `App` mounts, it checks `window.location.hash`. If a share payload is present, it
shows `SharedNoteDialog` with a preview, and the option to import it as a new note.

### Import / Export

`utils/importExport.ts` handles backups (the export zip, and the JSON that earlier versions wrote) and
drops of single notes (Markdown, plain text, image files). `importedNote.ts` changes file contents
into notes, and `noteDownload.ts` saves one note. `App` registers window-level
`dragenter`/`dragover`/`dragleave`/`drop` handlers. Thus, you can drop files anywhere on the window.
Dropped imports become new notes (or a bulk import for JSON backups).

### Internationalization

The translations are in `i18n/messages/`. Now there are `en` (default) and `fi`.
`i18n/locales.ts` declares `SUPPORTED_LOCALES`. The active locale is the `locale` preference signal.
`t(key, vars?)` and `plural(key, n)` read that signal. Thus, all callers render again automatically
when the user changes the language. If a key is missing, the app uses the default locale, and then
the key itself (with a warning in dev mode). `detectBrowserLocale()` gets the first locale from the
browser, unless the user saved a preference.

### Component Patterns

- **NoteEditor** gets all of its data from props (title, content, color, font, callbacks). The
  parent components (`NoteCardEditor`, `NoteInput`) own the state.
- **NoteCardEditor** wraps NoteEditor to edit existing notes. It controls the auto-save (500 ms
  debounce) and the version history. Milkdown does the undo and redo.
- **Dropdown** is the generic popover pattern (for the color picker, the font picker, the kebab
  menu). Its props are `open`/`onClose`/`trigger`/`children`. It uses `Popover`, the lower-level
  positioning primitive.

## Theming

### Note Colors

In `colors.ts`, each `NoteColor` enum value has Tailwind utility classes for the background, hover
and border. The map has light and dark variants (for example `bg-yellow-100 dark:bg-yellow-900`).
Thus, themes can give different colors in each mode, and the data model does not change.

### Dark Mode

The preference has three values (`system`, `light` or `dark`), stored in `prefs.ts`. A signal
`effect` toggles the `dark` class on `<html>`. In system mode, it also subscribes to changes of
`prefers-color-scheme`. Settings, Appearance shows the three values as sample windows
(`ThemePicker`). Each sample has the shade selected for it. The selects for the light and dark shades
are under the light and dark samples.

## Responsive Design

- **Desktop / tablet** (≥ 768 px): a collapsed sidebar rail with only icons on the left, a search bar
  in the center of the header, and a grid with many columns.
- **Mobile** (< 768 px):
  - A horizontal nav bar under the header replaces the sidebar.
  - The header shows a search icon button (it opens the search view with an inline input) and the
    view, sort and settings controls.
  - A floating `+` button at the bottom right opens the new-note modal.
  - Touch targets have a size for thumbs.
  - You can pinch-zoom the page. The viewport meta sets no maximum scale. Focus on a field does not
    zoom, because text fields are 16 px on a phone, and `touch-action: manipulation` turns off the
    double-tap zoom.

## Accessibility

The target is WCAG 2.1 AA. [Accessibility](../accessibility.md) tells what that includes, what is
still open, and what a deployment possibly must publish. In the client, this means:

- Semantic HTML: `<main>`, `<nav>`, headings for the sections of the board, and an `<article>` for
  each note. A visually hidden button (`[data-card-open]`) opens the note. The card itself is not a
  button, because that hides the controls inside it.
- Keyboard: Tab or `j` / `k` through cards, Enter to open, `Shift j` / `Shift k` to reorder, Escape
  to close the newest layer (`useEscapeStack`). Modals keep Tab inside them (`useFocusTrap`).
  Dropdowns and card popovers move focus in when they open, and back to their trigger when they
  close.
- Names and states: each icon-only button has an `aria-label` from the catalogue. Buttons that open a
  panel have `aria-expanded`, and the current option in a picker has `aria-pressed`.
- Announcements: live regions for toasts, the connection status, inline calculation results and
  reorders (`boardAnnouncement`).
- A contrast of 4.5:1 for text and 3:1 for controls in both themes, and one focus ring
  (`:focus-visible` in `styles/setup.css`). Text and icons on a note get their tone from `noteText`
  in `colors.ts`. `colors.test.ts` measures it on each note color in each shade. An item that must
  look done or past has a line through it, or a different position. It is never paler through
  opacity.
- Targets of 24 by 24 px or larger (WCAG 2.5.8). A control that looks smaller (the select circle,
  the checkbox of a card, the clear button of a reminder) gets the size from an invisible margin
  around it.
- A bar never hides focus. The board scrolls a card out from under the top bar of the phone
  (`scroll-padding-top`). A phone sheet scrolls a control that the keyboard reaches out from under
  its sticky bars (`keepFocusClear` in `utils/phoneSheets.ts`).
