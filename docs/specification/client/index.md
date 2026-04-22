# Client

The Manifesto client is a static single-page application built with Preact and TypeScript. It is local-first: all features work offline against `localStorage`, and a server is only needed for multi-device sync.

## Tech Stack

| Technology                                                         | Purpose                                |
|--------------------------------------------------------------------|----------------------------------------|
| Preact + `@preact/signals`                                         | UI framework and reactive state        |
| Vite + `@preact/preset-vite`                                       | Build tool and dev server              |
| TypeScript (strict)                                                | Language                               |
| Tailwind CSS v4 (via `@tailwindcss/vite`)                          | Styling — CSS-first, no config file    |
| Milkdown (`@milkdown/kit`)                                         | Markdown editor (CommonMark + GFM)     |
| remark / rehype / unified                                          | Read-only markdown → HTML for previews |
| DOMPurify                                                          | HTML sanitization for rendered preview |
| lucide-preact                                                      | Icon library                           |
| ulid                                                               | Lexicographically sortable note IDs    |
| lz-string                                                          | Compression for sharing + versions     |
| clsx                                                               | Conditional class name merging         |
| vite-plugin-pwa + workbox                                          | Service worker / installable PWA       |
| Vitest (+ `@vitest/browser` on Playwright Chromium)                | Testing                                |

### Why Preact

- React-compatible API — React developers can contribute immediately
- ~3 KB runtime — fast loads, especially for self-hosted and PWA use
- First-party Signals library eliminates the need for external state management
- Sufficient for a notes app — no need for React's concurrent features

### Why Tailwind v4

- Utility classes directly in markup for rapid development
- CSS-first configuration via `@theme` in `styles.css` — no `tailwind.config.ts`
- Built-in dark mode via the `dark:` variant
- Production purge — only ships CSS that's actually used

## Source Layout

```
packages/client/src/
├── main.tsx              # Entry — mounts <App />, registers service worker
├── styles.css            # Tailwind v4 entry + @theme tokens
├── colors.ts             # NoteColor → Tailwind class maps (light + dark)
├── sharing.ts            # Encode/decode shared-note URL payloads (LZ-String)
├── components/           # All UI components (see hierarchy below)
├── extensions/           # ProseMirror/Milkdown extensions
├── hooks/                # Preact hooks (currently: useMilkdownEditor)
├── i18n/                 # Translation framework + en/fi message bundles
├── state/                # Signals, actions, preferences, reminder scheduler
├── storage/              # StorageAdapter interface + Local/Rest implementations
├── utils/                # importExport, linkPreview, markdown helpers, remarkRenderer
├── serviceWorker.ts      # PWA registration glue
└── sw.ts                 # Service worker source (Workbox precache + runtime)
```

## Architecture

### Component Hierarchy

```
App
├── Header
│   ├── Search input
│   ├── View toggle (grid/list)
│   ├── Sort menu (default / updated / created)
│   └── Settings button
├── Sidebar (desktop rail + mobile drawer)
│   ├── Notes
│   ├── Tags (→ TagsView)
│   ├── Reminders
│   ├── Archive
│   └── Trash
├── NoteInput              ("Take a note…" bar)
├── TagsView               (tag chip list with counts)
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
│       ├── ReminderPicker → MiniCalendar
│       ├── Dropdown            (color picker, font picker, kebab menu)
│       └── VersionHistory      (opened from kebab menu)
├── SharedNoteDialog       (when a share URL hash is present)
├── SettingsDialog         (theme, defaults, language, import/export/delete all)
├── ReminderBanner         (fires when a reminder is due)
└── Toasts                 (success + error notifications)
```

Shared primitives: `Dropdown`, `Popover`, `Tooltip`, `ToggleSwitch`.

### State Management

State lives in `packages/client/src/state/` and is reactive via `@preact/signals`.

- **`actions.ts`** — core `notes` signal; computed `filteredNotes` / `sortedNotes` / `pinnedNotes` / `unpinnedNotes` / `allTags`; async action functions (`createNote`, `updateNote`, `trashNote`, `bulkArchive`, `reorderNotes`, `importNotes`, `exportNotes`, …). Actions update both signals and the storage adapter.
- **`ui.ts`** — transient UI state: `activeView`, `activeTag`, `editingNoteId`, `searchQuery`, `selectMode`, `selectedNotes`, `mobileSidebarOpen`, `showSettings`, plus the toast queue (`toasts`, `showError`, `showSuccess`, `dismissToast`).
- **`prefs.ts`** — user preferences persisted to `localStorage` under `manifesto:prefs` via a debounced `effect()`. Covers `viewMode`, `noteSize`, `sortMode`, `theme`, `defaultNoteColor`, `defaultNoteFont`, and `locale`. Also owns theme application (toggles `dark` class on `<html>` and listens for system preference changes).
- **`reminderScheduler.ts`** — timer loop that fires `reminder:open-note` events when a reminder is due.
- **`index.ts`** — barrel export of the public state API.

### Storage Adapters

The client talks to persistence through a `StorageAdapter` interface (`storage/StorageAdapter.ts`) declaring `getAll`, `get`, `create`, `update`, `delete`, `deleteAll`, `search`, `importAll`.

- **`LocalStorageAdapter`** (default) — stores notes as JSON in `localStorage` under `manifesto:notes`. Generates ULIDs, fills in defaults for newer fields (font, images, link previews, reminder) when reading legacy records. ~5–10 MB limit, single device.
- **`RestApiAdapter`** — implementation that speaks to a Manifesto server via the REST API. Scaffolded for future use; not yet selected by the factory.

Adapter resolution at startup is done by `createStorage()` in `storage/index.ts`. It currently returns `LocalStorageAdapter` unconditionally; the hook for switching to `RestApiAdapter` when a server is configured is the intended extension point (see [Deployment](deployment.md)).

### Editor

Markdown editing uses **Milkdown** (`@milkdown/kit`) with the CommonMark + GFM presets, plus the `history`, `clipboard`, and `listener` plugins. The editor is instantiated in `hooks/useMilkdownEditor.ts` and rendered by `components/MilkdownEditor.tsx`. Undo/redo flows through Milkdown's history plugin (`callCommand(undoCommand)` / `redoCommand`) — there is no separate undo/redo hook.

Custom ProseMirror behavior lives in `packages/client/src/extensions/`:

- **`manifestoInlineMarks`** — adds underline / subscript / superscript marks that round-trip through markdown as `<u>`/`<sub>`/`<sup>` tags.
- **`taskItemDraggable`** — drag-and-drop reordering and indent/outdent for checklist items.

Read-only previews (inside `NoteCard` and shared-note dialogs) are rendered by `utils/remarkRenderer.ts` — a `unified` pipeline of `remark-parse` → `remark-gfm` → `remark-breaks` → `remark-rehype` → `rehype-stringify`, with output sanitized via DOMPurify before being inserted.

`MilkdownEditor` reads the markdown back out via `getMarkdown()` and post-processes it (`unescapeBrackets`, `collapseListSpread`) to keep round-trips stable with the preview renderer.

### Version History

Notes have persistent version history stored LZ-String compressed in `localStorage` under `manifesto:versions`. Versions are saved automatically when the editor closes with changes (capturing the pre-edit state). Capped at 50 per note, pruned after 90 days. Storage: `storage/VersionStorage.ts`. UI: `components/VersionHistory.tsx`, accessed via the kebab menu in the note editor.

### Reminders

Each note has an optional `reminder` timestamp set via `ReminderPicker` (with `MiniCalendar`). `state/reminderScheduler.ts` subscribes to the `notes` signal and uses timers to fire at the scheduled time; when one fires it shows `ReminderBanner` and dispatches a `reminder:open-note` window event that `App` listens for to open the relevant note.

### Sharing

`sharing.ts` encodes a note payload into a compact URL hash (`#share=…`) using LZ-String compression. When `App` mounts it checks `window.location.hash` and, if a share payload is present, shows `SharedNoteDialog` with a preview and the option to import it as a new note.

### Import / Export

`utils/importExport.ts` handles JSON backup roundtrips and per-note drops (Markdown, plain text, image files). `App` registers window-level `dragenter`/`dragover`/`dragleave`/`drop` handlers so files can be dropped anywhere on the window; dropped imports become new notes (or a bulk import for JSON backups).

### Internationalization

Translations live in `i18n/messages/` — currently `en` (default) and `fi`. `SUPPORTED_LOCALES` is declared in `i18n/locales.ts`. The active locale is the `locale` preference signal; `t(key, vars?)` and `plural(key, n)` read that signal, so all call sites re-render automatically when the user changes language. Missing keys fall back to the default locale, then to the key itself (with a dev-mode warning). Initial locale is detected from the browser via `detectBrowserLocale()` unless the user has an explicit preference saved.

### Component Patterns

- **NoteEditor** is fully prop-driven (title, content, color, font, callbacks). Parent components (`NoteCardEditor`, `NoteInput`) own the state.
- **NoteCardEditor** wraps NoteEditor for editing existing notes — manages auto-save (500 ms debounce) and version history. Undo/redo is delegated to Milkdown.
- **Dropdown** is the generic popover pattern (used for color picker, font picker, kebab menu) — `open`/`onClose`/`trigger`/`children` props. `Popover` is the lower-level positioning primitive it's built on.

## Theming

### Note Colors

Each `NoteColor` enum value maps to Tailwind utility classes for background, hover, and border in `colors.ts`. The map provides both light and dark variants (e.g. `bg-yellow-100 dark:bg-yellow-900`), so themes can map colors differently between modes without touching the data model.

### Dark Mode

Three-way preference — `system`, `light`, or `dark` — stored in `prefs.ts`. A signal `effect` toggles the `dark` class on `<html>`; in system mode it also subscribes to `prefers-color-scheme` changes.

## Responsive Design

- **Desktop** (> 1024 px) — Full sidebar visible, multi-column grid
- **Tablet** (768–1024 px) — Collapsible sidebar, fewer grid columns
- **Mobile** (< 768 px) — Slide-out sidebar drawer (`mobileSidebarOpen` signal), single or two-column grid, touch-optimized targets

## Accessibility

- Semantic HTML (`<main>`, `<nav>`, `<article>` for notes)
- Keyboard navigation (Tab through notes, Enter to open, Escape to close editor)
- ARIA labels on icon-only buttons
- Focus management when opening/closing modals
- Sufficient color contrast in all themes
