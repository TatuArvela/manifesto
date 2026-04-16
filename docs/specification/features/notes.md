# Notes

Notes are the core entity in Manifesto. A note is a card with a title, markdown content, and metadata.

## Creating a Note

A persistent "Take a note..." input bar sits at the top of the note grid. On focus, it expands to reveal separate title and content fields. Pressing away or clicking a close button creates the note if either field has content.

New notes default to: color `default` (or random, per user preference), font `default` (or user's chosen default), not pinned, not archived, not trashed, no tags.

## Editing a Note

Clicking a NoteCard opens the NoteEditor as a modal overlay. The editor provides:

- Title field (plain text)
- Content field (plain textarea for editing markdown)
- Preview toggle to see rendered markdown
- Color picker
- Font picker (Default, Permanent Marker, Comic Relief)
- Tag picker
- Kebab menu with version history, sharing, and delete
- Toolbar with pin, archive, and undo/redo actions

Changes are saved on close (or debounced while editing).

## Colors

Notes can be assigned a color from a predefined set (see `NoteColor` in [Data Model](../data-model.md)). Colors are displayed as the note card's background. Both light and dark theme variants are defined for every color.

## Pinning

Toggling the pin icon sets `pinned: true/false`. Pinned notes appear in a separate section at the top of the grid, labeled "Pinned." Unpinned notes appear below under "Others" (label only shown when pinned notes exist).

## Ordering

Notes can be sorted in three modes, selectable from the header:

- **Default** — Manual drag-and-drop ordering. New notes are placed in creation order. The user can rearrange notes freely by dragging. The custom position is stored in the `position` field (see [Data Model](../data-model.md)).
- **Updated** — Last updated first.
- **Created** — Most recently created first.

Pinned and unpinned sections each maintain their own order independently. In default mode, each section has its own drag-and-drop sequence.

In server mode, manual ordering is per-user — each user has their own arrangement.

## Grid and List Views

- **Grid view** (default) — Responsive masonry-like grid. Notes have varying heights based on content (capped with overflow).
- **List view** — Single-column, full-width layout.

Toggled via a ViewToggle button in the header.

## Sidebar

A collapsible navigation panel on the left with links to:

- Notes (active, main view)
- Archive
- Trash
- Tag list for filtering

On mobile, the sidebar is a slide-out drawer.
