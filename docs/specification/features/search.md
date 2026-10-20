# Search

The header has a search bar. Use it to search the full text of all notes.

## Behavior

- The input is debounced. The field shows each keystroke immediately. The results change when you
  stop typing for 200ms. When you empty the field, the results clear immediately.
- A note matches when its `title` or `content` contains all of the words of the query, in any
  order. A word can be part of a longer word ("grocer" finds "groceries"). A word can also be inside
  markdown ("milk" finds `**milk**`).
- The search ignores case and accents on both sides: "cafe" finds "Café", and "sää" finds "saa".
- Notes with a query word in the title show first. In that group, and in the other notes, the
  usual sort order of the view applies.
- The search applies to the current view (active notes, archive, or trash).
- The app does not save searches. A tag is the named group of notes (see
  [Non-goals](../non-goals.md)).

## Implementation

In both modes, the client searches the notes that it keeps in memory. A connected client already
keeps all of the notes that it can read (see [API](../api.md#paging-the-list-endpoints)). In
connected mode, the client is the only place that can search the notes, because the server keeps
them [sealed](encryption.md). The client folds the text of each note one time, and keeps the result
until the note changes.

`GET /api/v1/search?q=` (see [API](../api.md#search)) sends `403` to the session of the app. It is
for API clients and for the MCP `search_notes` tool. The tokens of those clients contain a key.
