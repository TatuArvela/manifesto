# Search

A search bar in the header allows full-text search across all notes.

## Behavior

- Input is debounced: the field follows every keystroke and the results follow once typing pauses for 200ms. Emptying the field clears the results at once.
- Filters notes by substring match on `title` and `content` (case-insensitive)
- Search applies to the current view (active notes, archive, or trash)

## Implementation

- **Local storage**: Client-side filtering over all notes in memory
- **Connected mode**: the client holds every note (see Pagination in the API doc) and filters them
  the same way. The server answers `GET /api/search?q=` (see [API](../api.md)) for other clients, from
  a word index rather than a scan.

## Server index

Each driver keeps a `note_terms` table: one row per distinct word of a note's title and content, with
how often it occurs. The words are cut in JavaScript (`storage/searchTerms.ts`, `Intl.Segmenter`),
not by the database: SQLite's FTS5 and Postgres's `tsvector` tokenize and stem differently, so native
indexes would have the two drivers disagree about what a search finds, and pg-mem, which the Postgres
tests run on, has neither. A query word is a prefix range scan (`term >= lo AND term < hi`) on a
B-tree over `term`, which needs byte order: SQLite's default, and `COLLATE "C"` in Postgres.

A write that changes the title or content sets the note's `search_version` to 0 in the same
statement and rewrites its words after; a note whose `search_version` is not the tokenizer's current
`SEARCH_INDEX_VERSION` is indexed at startup. That backfills a database from before the index,
re-indexes everything after a tokenizer change (bump the constant), and repairs a note whose words
were not written because the process stopped in between.
