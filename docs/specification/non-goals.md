# Non-goals

This page lists the things that Manifesto decided not to do. We examined each one. Each decision
stays until its reasons change. A proposal to examine one again must tell what changed.

## Features

- **Wiki links and backlinks** (the `[[Note title]]` syntax with a "linked from" list): they change a
  board of sticky notes into a graph of pages. They need many rules: a link to a trashed note, a link
  that a share recipient cannot open, a changed title. The board does not have that complexity now.
  Tags group notes. This does not prevent a usual link that opens a note.
- **Saved searches** (a named query in the sidebar with its own route): the sidebar contains views
  and tags, and a tag is already a named group of notes. [Search](features/search.md) is to find
  something now.
- **Print styles and PDF export**: the print function and the "save as PDF" function of the browser
  work on the rendered note, as on all pages. [Export](features/export-import.md) is the method to
  move notes out of the app, as Markdown and JSON that other tools can read.
- **Word count, character count and reading time**: these are measurements for a writing tool. A
  sticky note is short, and you can see all of it.
- **Voice memos as attachments**: an attachment is an image. The app draws it on the card, and makes
  it smaller when you attach it ([Attachments](features/attachments.md)). Audio needs a recorder, a
  player on the card and in the sheet, and a place in the export. A sticky note is not for audio. For
  the same reason, the Keep importer does not import voice recordings.
- **Folders**: a note in a folder is in only one place. Tags prevent this. A tag already groups
  notes, a note can have many tags, and [tags](features/tags.md) organize the sidebar.
- **Notion-style structure**: databases and typed properties on notes, pages in pages, and block
  tools in the editor (a `/` command menu, callouts, toggles that collapse). The first two change a
  sticky note into a record or into a page in a tree. Tags and the board already do that work. Each
  block tool adds an editor node. Each node makes `EDITOR_SCHEMA_VERSION` higher, and needs a
  Markdown form in the export. Notes are too short to need them.
- **Note templates** (notes marked as templates, that the composer shows as a start for a new note):
  Duplicate in the menu of a note already copies any note. Thus, a note in the archive can be a
  template, and no new function is necessary. A row of templates in the composer adds clutter to each
  new note. A mark that tells which notes are templates is one more rule for tags or for the note.
- **Reminders, priorities or locations on a checklist item**: a checklist is a GFM task list in the
  Markdown of the note ([Checklists](features/checklists.md)). Its items have no identity that a
  scheduler can use. A reminder belongs to the note. A date on an item belongs in the text of the
  item.
- **Two-way CalDAV for checklists** (items as `VTODO`s that the reminders app of a phone edits): the
  protocol is the small part. An edit that comes back refers to an item that has no stable ID. The
  app must then merge it into the collaborative document, and guess which line it is. The
  [calendar feed](features/reminders.md) publishes reminders read-only.
- **App-store builds** (Capacitor or other native shells): the app is a PWA from its own origin. A
  shell runs it from a different origin. Thus, `SERVER_URL` can never be same-origin. Each custom
  instance needs its own store build for its branding, and each release must go through a store
  review. A shell gives reminders that arrive while the app is closed. Web Push already gives this
  for an installed PWA in connected mode.

## Architecture

- **A server-side plugin API**, on which third parties run code inside the server: it needs a
  compatibility promise to each plugin, and a test matrix to keep that promise.
  [Auto-notes](features/auto-notes.md) run user code in a sandbox in the browser.
  [Webhooks](features/webhooks.md) and the [REST API](api.md) connect to all other systems.
- **Redis, a search engine or a different second service as a requirement**: a self-hosted server is
  one container. Postgres is optional. If a function needs a different service, it first gets a
  default inside the process. The service is only an option.
- **Encryption as an option**, for some accounts, or for notes that you lock one at a time: all
  accounts in connected mode have the same end-to-end encryption
  ([Encryption](features/encryption.md)). An option makes two types of note. Each feature that uses
  the content of a note (sharing, collaboration, previews, reminders, tokens, webhooks) then needs
  two implementations.
- **Notes that load on demand, with search on the server**: the client gets all of the pages of
  `/api/v1/notes`, because it calculates the tag counts, the tag list and the filter chain from the
  full list. Also, open mode has no server for search. Paging sets a limit on the size of a
  response, and images load when you scroll to them. The notes stay in memory. A board of sticky
  notes is not an archive of hundreds of thousands of documents.
