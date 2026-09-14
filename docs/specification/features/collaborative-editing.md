# Collaborative Editing

In connected mode, several people can edit the same note simultaneously, with changes appearing in real time: the owner's own devices and tabs, and everyone the note is [shared with](sharing-with-people.md) to edit. Collaboration runs over Yjs via the [Hocuspocus](https://tiptap.dev/hocuspocus) protocol; persistence lives in whichever storage driver the server is configured with.

## Behavior

- When a user opens a note that another user is also editing, both see each other's changes live.
- Text edits, checkbox toggles, list reordering, and other in-document changes propagate over the Yjs WebSocket (`/api/yjs`, see [API](../api.md)). The note id is the Hocuspocus document name.
- Conflicting edits are resolved by the Yjs CRDT: concurrent insertions and deletions converge without data loss.
- REST writes (`PUT /api/notes/<id>`) remain the authoritative path for note metadata (color, tags, archived/trashed). Optimistic concurrency on REST is enforced via `If-Match: <updatedAt>` and a 412 + 3-way merge on the client.

## Presence

- Clients see who else is currently viewing or editing a note: the owner and everyone who has accepted it, whatever their role. A presence report for a note the reporting user cannot see is ignored.
- Presence appears as avatar stacks on the note card and inline cursors in the editor.
- Presence updates flow through the application WebSocket (`/api/ws`) using `presence:join`, `presence:leave`, and `presence:update` events.

## Offline Support

- Each note's Y.Doc is mirrored to IndexedDB on the client, so edits keep working when the connection is lost.
- Queued changes sync when the connection is restored, using the Yjs sync protocol, with no manual reconciliation.
- The UI surfaces a connection-status indicator when the application socket is disconnected.

## Authorization

- Both WebSocket endpoints authenticate via the configured `AuthProvider`. The application socket passes the bearer token in `Sec-WebSocket-Protocol`; the Yjs channel passes it in the Hocuspocus `Auth` message.
- The Yjs channel additionally verifies that the authenticated user may edit the note being joined: its owner, or someone it is shared with who accepted and can edit. Someone who can only view it is refused, and reads it through `note:updated` events instead. The check is against the document name in the protocol rather than the connection URL, and rejection happens at the `Auth` message, before the document is created or joined.
- Losing that right (removed from the note, made a viewer, or the owner trashing it) closes the person's whole collaboration socket, as ending a session does. The provider reconnects and is refused the note.
- The document's persisted state belongs to the note, stored under its owner whichever participant's edit is being saved.
