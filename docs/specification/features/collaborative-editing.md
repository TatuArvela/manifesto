# Collaborative Editing

In connected mode, several people can edit the same note simultaneously, with changes appearing in real time: the owner's own devices and tabs, and everyone the note is [shared with](sharing-with-people.md) to edit. Collaboration runs over Yjs via the [Hocuspocus](https://tiptap.dev/hocuspocus) protocol; persistence lives in whichever storage driver the server is configured with.

## Behavior

- When a user opens a note that another user is also editing, both see each other's changes live.
- Text edits, checkbox toggles, list reordering, and other in-document changes propagate over the Yjs WebSocket (`/api/yjs`, see [API](../api.md)). The note id is the Hocuspocus document name.
- Conflicting edits are resolved by the Yjs CRDT: concurrent insertions and deletions converge without data loss.
- REST writes (`PUT /api/notes/<id>`) remain the authoritative path for note metadata (color, tags, archived/trashed). Optimistic concurrency on REST is enforced via `If-Match: <updatedAt>` and a 412 + 3-way merge on the client.

## Why Metadata Stays Out of the Document

Only the text is shared through Yjs. Everything else about a note (title, colour, font, pin, archive,
trash, position, tags, reminder, images, link previews) is a row written over REST, and conflicts
there are settled by `If-Match` and the client's 3-way merge (`mergeNote.ts`). That is two conflict
models where one would do: AFFiNE keeps everything, metadata included, in Yjs documents, and has one
sync path. The split is deliberate, for these reasons:

- **Open mode never syncs.** It is the default build and keeps no Yjs at all (about 130 KB kept out of
  what every such user downloads). Metadata in a Y.Doc would put the stack back into that build, or
  leave open mode on a second model anyway.
- **Some fields are personal.** A shared note's colour, pin, archive, trash, position, tags and
  reminder are each recipient's own ([Sharing with people](sharing-with-people.md)). A Y.Doc is one
  state that every participant converges on, so these could never live in the note's document.
- **The server queries the rows.** Listing order, search, the change feed, trash expiry, statistics,
  export, webhooks and the MCP tools all read columns. Kept in Yjs, each would need the document
  decoded, or a copy of it kept in columns, which is two copies to keep in step again.
- **Most metadata changes happen without an editor.** Pinning, recolouring or tagging from the board
  is one request. Through Yjs it would be a socket joined, a document loaded and synced, and a
  change sent, for every card touched.

The cost is carried in two places. The text exists as both the row's `content` and the document (see
below), and every array field added to a note needs `mergeNoteUpdate` taught how to merge it, since
its default, the client's copy winning, drops another writer's additions.

Worth revisiting if a client appears that edits metadata offline for long stretches (a native app),
where per-field CRDT merging would beat a 3-way merge on reconnect. Personal fields would still stay
out.

## Content Written Outside the Document

The note row's `content` and the shared document are two copies of the text. The editor keeps the row
up to date by saving what the document holds, and once a note has a document the editor shows the
document, not the row. Some writes reach only the row: an assistant's `update_note`
([MCP](mcp.md)), a script on the [REST API](../api.md), a restored [version](version-history.md). An
editor that showed the document then would show the text from before, and its next save would write
that back over the change.

So the document records which texts came from it: before an editor sends the text, a hash of it
(the newest 50), and the row's `updatedAt` once a save has landed (`savedAt`). A row counts as written
outside when it is newer than `savedAt`, holds a text the document never sent, and differs from what
the document now says. Anything else is a row that is behind the document (another tab's save still
arriving, or offline typing whose saves failed), and the document still wins.

- An outside row is written into the document when an editor opens the note, and while one is open.
  A change that arrives while it is open waits a second first, since another tab's save and its record
  arrive over two sockets in no fixed order.
- Only one client writes it in: of those with the document open, the one with the lowest Yjs client
  id. Two writing it in would put the text in twice.
- If the document also held text that was never saved, that text is kept as a version first.
- It is not saved back to the row, which already holds it; the document records it as its own.
- A document from before these records never judges a row outside, and starts keeping them the first
  time an editor finds row and document agreeing.
- An editor with no shared document (open mode, a viewer) keeps the same records in memory, so a
  version restored while it is open still shows.

## Presence

- Clients see who else is currently viewing or editing a note: the owner and everyone who has accepted it, whatever their role. A presence report for a note the reporting user cannot see is ignored.
- Presence appears as avatar stacks on the note card and inline cursors in the editor.
- The name and colour at a remote cursor are the account's. The server replaces the `user` field of
  every awareness state a connection publishes with the authenticated user's id, display name and
  avatar colour, and drops any state for a client id that another connection already publishes, so
  one participant cannot label a cursor as someone else or move another person's cursor.
- Presence updates flow through the application WebSocket (`/api/ws`) using `presence:join`, `presence:leave`, and `presence:update` events.

## Offline Support

- Each note's Y.Doc is mirrored to IndexedDB on the client, so edits keep working when the connection is lost.
- Queued changes sync when the connection is restored, using the Yjs sync protocol, with no manual reconciliation.
- The UI surfaces a connection-status indicator when the application socket is disconnected.

## Editor Versions

An editor meeting a node or mark it has no schema for drops it, and the Yjs binding then writes the
loss back into every participant's copy. So one shared document is only ever edited by editors of
the same shape or newer:

- `EDITOR_SCHEMA_VERSION` (`@manifesto/shared`) numbers the document shape the editor writes. It is
  raised whenever a node or mark is added, removed or changes its attributes.
- The client sends it as the `editor` query parameter of the `/api/yjs` URL. The server refuses a
  version lower than its own, and one it cannot read, with the refusal reason `editor-outdated`,
  before it checks the session. A client that sends none counts as version 1, the shape from before
  the check.
- A client refused that way locks the note's text, since saving it over REST instead would write
  its own reading of the note over content it did not understand. The editor says that a newer
  version is in use and offers a reload, which clears the installed copy first. The title, colour,
  tags and the rest stay editable.
- A client newer than the server is admitted: the server stores updates without reading them.

## Authorization

- Both WebSocket endpoints authenticate via the configured `AuthProvider`. The application socket passes the bearer token in `Sec-WebSocket-Protocol`; the Yjs channel passes it in the Hocuspocus `Auth` message.
- The Yjs channel additionally verifies that the authenticated user may edit the note being joined: its owner, or someone it is shared with who accepted and can edit. Someone who can only view it is refused, and reads it through `note:updated` events instead. The check is against the document name in the protocol rather than the connection URL, and rejection happens at the `Auth` message, before the document is created or joined.
- Losing that right (removed from the note, made a viewer, or the owner trashing it) closes the person's whole collaboration socket, as ending a session does. The provider reconnects and is refused the note.
- The document's persisted state belongs to the note, stored under its owner whichever participant's edit is being saved.
