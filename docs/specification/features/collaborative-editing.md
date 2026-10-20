# Collaborative Editing

In connected mode, many people can edit the same note at the same time, and the changes show in real
time. This applies to the devices and tabs of the owner, and to all persons who have the note
[shared with](sharing-with-people.md) them to edit. Collaboration runs over Yjs, through the
[Hocuspocus](https://tiptap.dev/hocuspocus) protocol. The storage driver of the server keeps the
data.

## Behavior

- When a user opens a note that a different user also edits, both see the changes of the other
  immediately.
- Text edits, checkbox toggles, list reorders and other changes in the document go over the Yjs
  WebSocket (`/api/v1/yjs`, see [API](../api.md)). The note id is the Hocuspocus document name.
- The Yjs CRDT resolves conflicting edits. Insertions and deletions at the same time converge
  without data loss.
- REST writes (`PUT /api/v1/notes/<id>`) stay the authoritative path for note metadata (color, tags,
  archived/trashed). `If-Match: <updatedAt>` gives optimistic concurrency on REST. On a 412, the
  client does a 3-way merge.

## Sealed

The server relays and stores the shared document, but it cannot read it
([Encryption](encryption.md#collaboration)). There are two documents:

- **The readable document** is the note, as the editor binds to it. It is in the browser only.
- **The document on the wire** is what the server syncs, merges and stores. `y-indexeddb` keeps it
  for offline editing. It contains a list of entries. Each entry is an edit to the readable document,
  or a snapshot of all of it. Each entry is sealed with AES-256-GCM, with a key made from the note key
  only for edits. Each entry is bound to the note and to the version of the key.

The editor seals each edit that it makes, and appends it. The editor opens each entry that arrives,
and applies it. The clients do the merge. Yjs merges in the same way in all places. The server only
merges the list of opaque entries. If an entry does not open (a different key, or damage), the client
skips it, and the editor tells that some changes do not show. If an edit is still in the seal step
when the note closes, the client writes it before the document.

- **The clients do the compaction.** When a note has 200 edits, a client appends a snapshot of the
  full document. The client keeps the edits of a snapshot until the next snapshot arrives. It keeps
  the last three snapshots. Thus, it can skip a faulty snapshot, and not lose the edits that the
  snapshot was to contain.
- **When a note opens cold**, the client reads all of the snapshots and edits that are there. Their
  order is not important to Yjs.
- **`synced`** is reported when all entries that arrived are in the readable document. The editor
  relies on that promise.

## Why Metadata Stays Out of the Document

Yjs shares only the text. All other data of a note (title, color, font, pin, archive, trash,
position, tags, reminder, images, link previews) is a row that the client writes over REST.
`If-Match` and the 3-way merge of the client (`mergeNote.ts`) settle the conflicts there. That is two
conflict models where one is possible: AFFiNE keeps all data, also metadata, in Yjs documents, and has
one sync path. The split is on purpose, for these reasons:

- **Open mode never syncs.** It is the default build, and it has no Yjs (approximately 130 KB that
  each such user does not download). Metadata in a Y.Doc puts the stack back into that build, or open
  mode keeps a second model.
- **Some fields are personal.** The color, pin, archive, trash, position, tags and reminder of a
  shared note belong to each recipient ([Sharing with people](sharing-with-people.md)). A Y.Doc is
  one state on which all participants converge. Thus, these fields can never be in the document of
  the note.
- **The server queries the rows.** The listing order, search, the change feed, the trash expiry,
  statistics, export, webhooks and the MCP tools all read columns. In Yjs, each of these needs the
  decoded document, or a copy of it in columns. That gives two copies to keep the same again.
- **Most metadata changes occur without an editor.** To pin, recolor or tag from the board is one
  request. Through Yjs, each touched card needs a joined socket, a loaded and synced document, and a
  sent change.

The cost is in two places. The text exists in the `content` of the row and in the document (see
below). Each array field that you add to a note needs a case in `mergeNoteUpdate`. Its default, where
the copy of the client wins, deletes the additions of a different writer.

Examine this again if a client comes that edits metadata offline for long periods (a native app).
There, a CRDT merge for each field is better than a 3-way merge on reconnect. Personal fields still
stay out.

## Content Written Outside the Document

The `content` of the note row and the shared document are two copies of the text. The editor keeps
the row up to date, because it saves the contents of the document. When a note has a document, the
editor shows the document, not the row. Some writes go only to the row: the `update_note` of an
assistant ([MCP](mcp.md)), a script on the [REST API](../api.md), a restored
[version](version-history.md). An editor that shows the document then shows the old text. Its next
save writes that old text over the change.

Thus, the document records which texts came from it:

- Before an editor sends the text, it records a hash of the text (the newest 50).
- When a save arrives, it records the `updatedAt` of the row (`savedAt`).

A row is written outside when all of these are true: it is newer than `savedAt`, it contains a text
that the document never sent, and it is different from the current document. All other rows are
behind the document (the save of a different tab that did not arrive yet, or offline typing whose
saves failed). Then the document still wins.

- The client writes an outside row into the document when an editor opens the note, and while an
  editor is open. A change that arrives while the editor is open waits one second first. The save of
  a different tab and its record arrive over two sockets, in no fixed order.
- Only one client writes it in: the client with the lowest Yjs client id, of the clients that have
  the document open. If two clients write it in, the text is there two times.
- If the document also contained text that was never saved, the client keeps that text as a version
  first.
- The client does not save it back to the row, because the row already contains it. The document
  records it as its own.
- A document from before these records never decides that a row is outside. It starts to keep them
  the first time that an editor finds that the row and the document agree.
- An editor with no shared document (open mode, a viewer) keeps the same records in memory. Thus, a
  version restored while it is open still shows.

## Presence

- Clients see who else looks at or edits a note now: the owner and all persons who accepted it,
  whatever their role. The server ignores a presence report for a note that the reporting user
  cannot see.
- Presence shows as avatar stacks on the note card, and as inline cursors in the editor.
- The name and color at a remote cursor come from the account. The server replaces the `user` field
  of each awareness state that a connection publishes with the id, display name and avatar color of
  the authenticated user. It drops each state for a client id that a different connection already
  publishes. Thus, a participant cannot give a cursor the name of a different person, or move the
  cursor of a different person.
- Presence updates go through the application WebSocket (`/api/v1/ws`), with the events
  `presence:join`, `presence:leave` and `presence:update`.

Cursors are also sealed, with their own key. A client sends its cursor as ciphertext. The server
adds the authenticated account to each state, and refuses a state for a client id that a different
connection has. For neither of these does it have to read anything. A client shows the name and color
that the server added, and ignores the name inside.

## Offline Support

- The client mirrors the Y.Doc of each note to IndexedDB. Thus, edits continue to work when the
  connection is lost.
- When the connection comes back, the waiting changes sync with the Yjs sync protocol. No manual
  reconciliation is necessary.
- When the application socket is disconnected, the UI shows a connection-status indicator.

## Editor Versions

When an editor finds a node or mark for which it has no schema, it removes it. The Yjs binding then
writes the loss back into the copy of each participant. Thus, only editors of the same shape, or
newer, can edit one shared document:

- `EDITOR_SCHEMA_VERSION` (`@manifesto/shared`) is the number of the document shape that the editor
  writes. We make it higher each time a node or mark is added or removed, or changes its attributes.
- The client sends it as the `editor` query parameter of the `/api/v1/yjs` URL. The server refuses a
  version lower than its own, and a version that it cannot read, with the reason `editor-outdated`.
  It does this before it checks the session. A client that sends no version counts as version 1, the
  shape from before the check.
- A client that is refused in that way locks the text of the note. If it saved the text over REST, it
  writes its own reading of the note over content that it did not understand. The editor tells that a
  newer version is in use, and offers a reload. The reload clears the installed copy first. The
  title, color, tags and the other fields stay editable.
- The server admits a client that is newer than the server. The server stores updates without a read.

## Authorization

- Both WebSocket endpoints authenticate through the configured `AuthProvider`. The application socket
  sends the bearer token in `Sec-WebSocket-Protocol`. The Yjs channel sends it in the Hocuspocus
  `Auth` message.
- The Yjs channel also makes sure that the authenticated user can edit the joined note: its owner, or
  a person who has the note shared with them, accepted it, and can edit it. The channel refuses a
  person who can only view it. That person reads it through `note:updated` events. The check uses the
  document name in the protocol, not the URL of the connection. The refusal occurs at the `Auth`
  message, before the server creates or joins the document.
- When a person loses that right (removed from the note, changed to a viewer, or the owner puts it in
  the trash), the server closes the full collaboration socket of that person, as for the end of a
  session. The provider reconnects, and the server refuses the note.
- The persisted state of the document belongs to the note. The server stores it under the owner,
  whatever the participant whose edit it saves.
