# Collaborative Editing

In connected mode, multiple users can view and edit the same note simultaneously, with changes appearing in real time. Collaboration runs over Yjs via the [Hocuspocus](https://tiptap.dev/hocuspocus) protocol; persistence lives in whichever storage driver the server is configured with.

## Behavior

- When a user opens a note that another user is also editing, both see each other's changes live.
- Text edits, checkbox toggles, list reordering, and other in-document changes propagate over the Yjs WebSocket (`/api/yjs/notes/<id>`, see [API](../api.md)).
- Conflicting edits are resolved by the Yjs CRDT — concurrent insertions and deletions converge without data loss.
- REST writes (`PUT /api/notes/<id>`) remain the authoritative path for note metadata (color, tags, archived/trashed). Optimistic concurrency on REST is enforced via `If-Match: <updatedAt>` and a 412 + 3-way merge on the client.

## Presence

- Clients see who else is currently viewing or editing a note.
- Presence appears as avatar stacks on the note card and inline cursors in the editor.
- Presence updates flow through the application WebSocket (`/api/ws`) using `presence:join`, `presence:leave`, and `presence:update` events.

## Offline Support

- Each note's Y.Doc is mirrored to IndexedDB on the client, so edits keep working when the connection is lost.
- Queued changes sync when the connection is restored, using the Yjs sync protocol — no manual reconciliation.
- The UI surfaces a connection-status indicator when the application socket is disconnected.

## Authorization

- Both WebSocket endpoints authenticate via the configured `AuthProvider` using the bearer token passed in `Sec-WebSocket-Protocol`.
- The Yjs channel additionally verifies that the authenticated user owns the note before upgrading the connection. Sharing notes across users is not yet implemented in v1.
