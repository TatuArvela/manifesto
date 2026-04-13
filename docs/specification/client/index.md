# Client

The Manifesto client is a static single-page application built with Preact and TypeScript.

## Tech Stack

| Technology        | Purpose                    | Size       |
|-------------------|----------------------------|------------|
| Preact            | UI framework               | ~3 KB      |
| @preact/signals   | Reactive state management  | ~1 KB      |
| Vite              | Build tool and dev server   | —          |
| TypeScript        | Language (strict mode)      | —          |
| Tailwind CSS      | Styling                    | Purged     |
| marked            | Markdown rendering (GFM)   | ~23 KB     |
| ulid              | Note ID generation         | ~0.4 KB    |
| Vitest            | Testing                    | —          |
| vite-plugin-pwa   | PWA / service worker        | —          |

### Why Preact

- React-compatible API — React developers can contribute immediately
- ~3 KB vs React's ~40 KB — faster loads, especially for self-hosted and PWA use
- First-party Signals library eliminates the need for external state management
- Sufficient for a notes app — no need for React's concurrent features

### Why Tailwind CSS

- Utility classes directly in markup for rapid development
- Built-in dark mode via `dark:` variant
- Production purge — only ships CSS that's actually used
- Consistent design tokens out of the box

## Architecture

### Component Hierarchy

```
App
├── Header
│   ├── SearchBar
│   ├── ViewToggle (grid/list)
│   └── SettingsMenu
├── Sidebar
│   ├── NavItem (Notes)
│   ├── NavItem (Archive)
│   ├── NavItem (Trash)
│   └── TagList
├── NoteInput ("Take a note..." bar)
├── NoteGrid
│   ├── PinnedSection
│   │   └── NoteCard[]
│   └── UnpinnedSection
│       └── NoteCard[]
├── NoteEditor (modal overlay)
│   ├── MarkdownEditor
│   ├── ColorPicker
│   ├── TagPicker
│   └── Toolbar (pin, archive, delete)
└── SettingsDialog
    └── StorageConfig
```

### State Management

Preact Signals for reactive state. The app state includes:

- `notes` — All notes from the active storage adapter
- `searchQuery` — Current search input
- `viewMode` — Grid or list
- `filter` — Active, archived, or trash view
- `activeTag` — Tag filter, if any

Action functions (`createNote`, `updateNote`, `deleteNote`, etc.) call the storage adapter and update signals.

### Storage Adapters

The client interacts with data through a `StorageAdapter` interface (see [API](../api.md) and [Data Model](../data-model.md)).

- **LocalStorageAdapter** — Default. Stores notes as JSON in `window.localStorage`. Zero configuration. Limited to ~5-10 MB and single device.
- **RestApiAdapter** — Connects to a Manifesto server via the REST API. Configured via settings UI or `MANIFESTO_SERVER` env var.

Adapter resolution at startup:
1. If managed mode — use `RestApiAdapter` with the configured server
2. If open mode with a saved server URL — use `RestApiAdapter`
3. Otherwise — use `LocalStorageAdapter`

## Theming

### Note Colors

Each `NoteColor` maps to Tailwind utility classes for background, hover, and border. A color class map provides both light and dark variants (e.g., `bg-yellow-100 dark:bg-yellow-900`).

### Dark Mode

Uses Tailwind's `dark:` variant with the `media` strategy (follows system `prefers-color-scheme`).

## Responsive Design

- **Desktop** (>1024px) — Full sidebar visible, multi-column grid
- **Tablet** (768-1024px) — Collapsible sidebar, fewer grid columns
- **Mobile** (<768px) — Slide-out sidebar drawer, single or two-column grid, touch-optimized targets

## Accessibility

- Semantic HTML (`<main>`, `<nav>`, `<article>` for notes)
- Keyboard navigation (Tab through notes, Enter to open, Escape to close editor)
- ARIA labels on icon-only buttons
- Focus management when opening/closing modals
- Sufficient color contrast in all themes
