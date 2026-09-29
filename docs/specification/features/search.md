# Search

A search bar in the header allows full-text search across all notes.

## Behavior

- Input is debounced: the field follows every keystroke and the results follow once typing pauses for 200ms. Emptying the field clears the results at once.
- A note matches when its `title` or `content` holds every word of the query, in any order. A word
  may be part of a longer one ("grocer" finds "groceries") and may sit inside markdown ("milk" finds
  `**milk**`).
- Case and accents are ignored on both sides: "cafe" finds "Café", and "sää" finds "saa".
- Notes whose title holds a word of the query come first. Within that group and the rest, the
  view's sort order applies as usual.
- Search applies to the current view (active notes, archive, or trash)
- Searches are not saved; a tag is the named group of notes (see [Non-goals](../non-goals.md))

## Implementation

The client searches the notes it holds in memory, in both modes: a connected client already keeps
every note it can read (see [API](../api.md#paging-the-list-endpoints)), so a round trip would add
latency and nothing else. Each note's text is folded once and kept until the note changes.

`GET /api/search?q=` (see [API](../api.md)) is for API clients and the MCP `search_notes` tool. It
is a plainer match: the whole query as one substring of `title` or `content`, ignoring case (under
SQLite only for ASCII letters, since its `LOWER` knows no others) and with accents significant.
