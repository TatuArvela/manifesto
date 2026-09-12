# Notes

Notes are the core entity in Manifesto. A note is a card with a title, markdown content, and metadata.

## Creating a Note

A persistent "Take a note..." input bar sits at the top of the note grid. On focus, it expands to reveal separate title and content fields. Pressing Done (✓) creates the note, even an empty one. Closing any other way (Escape, clicking outside, the back arrow on phones) creates it only if it has a title, content, images or link previews, so opening the pad by accident leaves nothing behind. The discard button (✕) throws the draft away.

New notes default to: color `default` (or random, per user preference), font `default` (or user's chosen default), not pinned, not archived, not trashed, no tags.

## Editing a Note

Clicking a NoteCard opens the NoteEditor as a modal overlay. The editor provides:

- Title field (plain text)
- Content field: a rich markdown editor, with a raw mode that shows and edits the markdown source. Settings > Defaults > Default Edit Mode picks which one a note opens in. In connected mode raw edits reach collaborators as they are typed, and theirs appear in the textarea
- Formatting toolbar (headings, bold, italic, quotes, code, links, lists, checklists). In raw mode its buttons insert the markdown syntax instead. It can be hidden under Settings > Features, which hides it in every note
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

- **Default**: Manual drag-and-drop ordering. New notes are placed in creation order. The user can rearrange notes freely by dragging. The custom position is stored in the `position` field (see [Data Model](../data-model.md)).
- **Updated**: Last updated first.
- **Created**: Most recently created first.

Pinned and unpinned sections each maintain their own order independently. In default mode, each section has its own drag-and-drop sequence.

In connected mode, manual ordering is per-user: each user has their own arrangement.

## Grid and List Views

- **Grid view** (default): Responsive masonry-like grid. Notes have varying heights based on content (capped with overflow).
- **List view**: Single-column, full-width layout.

Toggled via a ViewToggle button in the header.

## Selecting Notes

Selected notes can be pinned, tagged, recoloured, archived or deleted together from the header, which turns into a selection bar while anything is selected. A selection is made by:

- the round checkbox at a card's top-left corner, which then toggles on click anywhere on the card
- a long press on touch devices
- "Select all" in the selection bar
- dragging a box with the mouse from empty space in the grid: every card the box touches is selected, except auto-notes, which "Select all" skips too. Shift or Cmd/Ctrl adds to the existing selection instead of replacing it, holding the pointer at the top or bottom edge scrolls, and Escape puts back the selection from before the drag

Clicking or tapping empty space in the grid, without dragging, clears the selection; with Shift or Cmd/Ctrl held it is kept.

## Sidebar

A collapsible navigation panel on the left with links to:

- Notes (active, main view)
- Archive
- Trash
- Tag list for filtering

On mobile, the sidebar is replaced by a horizontal icon bar directly under the header.
