# Search

A search bar in the header allows full-text search across all notes.

## Behavior

- Input is debounced
- Filters notes by substring match on `title` and `content` (case-insensitive)
- Matching terms are highlighted in results using `<mark>` elements
- Search applies to the current view (active notes, archive, or trash)

## Implementation

- **Local storage** — Client-side filtering over all notes in memory
- **Server mode** — Delegated to the server via `GET /api/search?q=` (see [API](../api.md))
