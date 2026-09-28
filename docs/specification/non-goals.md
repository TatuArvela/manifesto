# Non-goals

Things Manifesto has decided not to do. Each was considered, and the decision stands until what it
rests on changes. A proposal to revisit one should say what changed.

## Features

- **Wiki links and backlinks** (`[[Note title]]` syntax with a "linked from" list): they turn a board of
  sticky notes into a graph of pages, and every rule they need (a link to a trashed note, a link a share
  recipient cannot open, a renamed title) is complexity the board does not otherwise carry. Tags are how
  notes are grouped. This does not rule out an ordinary link that opens a note.
- **Saved searches** (a named query in the sidebar with its own route): the sidebar holds views and
  tags, and a tag already is a named group of notes. [Search](features/search.md) is for finding
  something now.
- **Print styling and PDF export**: the browser's own print and "save as PDF" work on the rendered
  note as they do on any page, and [Export](features/export-import.md) is how notes leave the app, as
  Markdown and JSON another tool can read.
- **Word count, character count and reading time**: measures for a writing tool. A sticky note is
  short enough to see whole.

## Architecture

- **A server-side plugin API** on which third parties run code inside the server: its cost is a
  compatibility promise to every plugin and a test matrix to keep it. [Auto-notes](features/auto-notes.md)
  run user code in a sandbox in the browser, and [webhooks](features/webhooks.md) and the
  [REST API](api.md) reach anything outside.
- **Redis, a search engine or any second service as a requirement**: a self-hosted server is one
  container, with Postgres optional. Anything that would want another service gets an in-process
  default first, and the service only as an option.
