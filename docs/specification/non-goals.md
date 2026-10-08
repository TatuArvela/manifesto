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
- **Voice memos as attachments**: an attachment is an image, drawn on the card and shrunk on attach
  ([Attachments](features/attachments.md)). Audio needs a recorder, a player on the card and in the
  sheet, and a place in export, all for something a sticky note is not for. The Keep importer skips
  voice recordings for the same reason.
- **Folders**: a note in one folder is a note filed in exactly one place, which is what tags avoid. A
  tag already groups notes, a note can carry several, and [tags](features/tags.md) are how the sidebar
  is organized.
- **Notion-style structure**: databases and typed properties on notes, pages nested in pages, and
  block tools in the editor (a `/` command menu, callouts, collapsible toggles). The first two turn a
  sticky note into a record or a page in a tree, which tags and the board already answer. The block
  tools each add an editor node that raises `EDITOR_SCHEMA_VERSION` and needs a Markdown form in
  export, for notes short enough not to need them.
- **Note templates** (notes marked as templates, offered in the composer to start a new note from):
  Duplicate in a note's menu already makes a copy of any note, so a note kept in the archive serves as
  a template with nothing built for it. A row of templates in the composer is clutter on every new
  note, and a marker for which notes are templates is one more rule for tags or for the note to carry.
- **Reminders, priorities or locations on a checklist item**: a checklist is a GFM task list in the
  note's Markdown ([Checklists](features/checklists.md)), and its items have no identity for a
  scheduler to name. A reminder belongs to the note, and a date on an item belongs in the item's text.
- **Two-way CalDAV for checklists** (items as `VTODO`s a phone's reminders app edits): the protocol is
  the small part. An edit coming back names an item that has no stable ID, and would have to be merged
  into the collaborative document by guessing which line it meant. The
  [calendar feed](features/reminders.md) publishes reminders read-only.
- **App-store builds** (Capacitor or any native shell): the app is a PWA served from its own origin,
  and a shell runs it from another one, so `SERVER_URL` could never be same-origin, every custom
  instance would need its own store build to carry its branding, and each release would pass through
  store review. What a shell would add, reminders that arrive with the app closed, comes from Web Push
  for a connected installed PWA.

## Architecture

- **A server-side plugin API** on which third parties run code inside the server: its cost is a
  compatibility promise to every plugin and a test matrix to keep it. [Auto-notes](features/auto-notes.md)
  run user code in a sandbox in the browser, and [webhooks](features/webhooks.md) and the
  [REST API](api.md) reach anything outside.
- **Redis, a search engine or any second service as a requirement**: a self-hosted server is one
  container, with Postgres optional. Anything that would want another service gets an in-process
  default first, and the service only as an option.
- **Loading notes on demand, with search moved to the server**: the client drains every page of
  `/api/notes`, because tag counts, the tag list and the filter chain are computed over the whole
  list, and open mode has no server to search on. Paging bounds a response and images load as they
  are scrolled to; the notes themselves stay in memory. A board of sticky notes is not an archive of
  hundreds of thousands of documents.
