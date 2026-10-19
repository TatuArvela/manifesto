---
paths:
  - "packages/client/src/realtime/**"
  - "packages/client/src/state/mergeNote.ts"
  - "packages/client/src/state/notesStore.ts"
  - "packages/client/src/state/pendingWrites.ts"
  - "packages/client/src/state/incomingNote.ts"
  - "packages/client/src/state/account/signOut.ts"
  - "packages/client/src/state/unsentNotes.ts"
  - "packages/client/src/components/ConnectionStatus.tsx"
  - "packages/server/src/ws/**"
  - "packages/server/src/routes/sync*.ts"
  - "packages/server/src/storage/contracts/syncContract.ts"
---

# Realtime and Conflict Resolution

## The two sockets

Server mode has two sockets. They carry different data.

`realtime/appSocket.ts` holds `/api/v1/ws` (note events and presence). It reconnects with
exponential backoff, to a maximum of 30s.

- Each reconnect *after the first* does a catch-up through `syncNotes`. The reason is that writes
  from a different device, made while this tab was offline, arrive through no other path.
- The catch-up asks `GET /api/v1/sync` for the changes since the checkpoint that `loadNotes` left.
  If a held note is not in the returned ids, the client drops it, but only if the client held the
  note before the request went out.
- A change of membership sets `notes.members_changed_at`, never `updated_at` (the `If-Match` token).
  Thus, a new way to join or leave a note must set it in both drivers. If not, the devices of the
  recipients never get the change (`storage/contracts/syncContract.ts`).

`realtime/yjsProvider.ts` holds `/api/v1/yjs`, with one `HocuspocusProvider` for each open note.
`y-indexeddb` is under it, so an offline edit stays after a reload. Both of these keep a sealed log
of the edits of the document, not the document (`sealedDocument.ts`; see `encryption.md`).

These copies stay after the session ends. Thus, the account menu signs out through `signOut`
(`state/account/signOut.ts`), which deletes them (`realtime/localNoteCopies.ts`). That file uses
plain IndexedDB, so that the entry has no Yjs. The notes list empties at each end of a session, and
a 401 is one of them. The `synced` flag of the provider is a correctness gate, not a spinner. See
"Collaborative binding" in `editor.md`.

A reconnect also sends the new notes that waited while the server was not available (`sendUnsent`,
`state/unsentNotes.ts`). The `online` event of the browser does the same. See `client-state.md`.

## Resume and heartbeat

When the page resumes, the client does not wait for the backoff. A frozen page comes back to a
socket that the browser closed. The throttled retries can also have made the backoff reach its
maximum. Thus, a `visibilitychange` to visible (and an `online` event) connects immediately and
resets the backoff. It connects when the socket is `CLOSED`, when there is no socket, and when the
socket has stopped. The reason for `CLOSED` is that a resume can deliver the visibility change
before the queued close event.

A socket that dies without a close stays `OPEN` at both ends. Thus:

- The server sends a ping each `APP_SOCKET_HEARTBEAT_MS`. It terminates a peer that did not answer
  the last ping.
- The server also sends a `heartbeat` event, because a page cannot see pings.
- The client stops a socket after two and a half beats without a message. It does this only after
  it received a heartbeat. Thus, the client does not reconnect forever to an older server that is
  quiet.

The token effect in `startAppSocket` does its work `untracked`. `setStatus` reaches code that reads
signals. A tracked read there runs the effect again, and that closes the socket.

The user side of the same event is `realtime/connectionOutage.ts`. The banner reports
`connectionOutage`, which is `connectionStatus` after a delay. It never reports the status directly.
If it does, each resume announces a reconnect that is almost complete. For the same reason:

- A teardown on purpose (`disconnect`, thus a logout or open mode) is `idle`, not `closed`.
- The delay starts one time for each outage, not one time for each status write, because
  `connecting` and `closed` alternate during the full outage.

## Limits on socket messages

Both server sockets set a limit on what they read before authentication. Without a limit, `ws`
assembles a frame of up to 100 MiB.

- `/api/v1/ws` uses `APP_SOCKET_MAX_PAYLOAD`. A client only tells which note it is on.
- `/api/v1/yjs` uses `MAX_YJS_BYTES` (`ws/yjsExtension.ts`). This is also the maximum size of the
  stored state of a note. Above it, `onStoreDocument` writes nothing and closes the sockets of the
  document, because no request schema examines the state.

If a client message on `/api/v1/ws` needs more space, make the constant larger at the same time. A
credential that expires closes its sockets through `ws/recheck.ts`, on a timer, because nothing
announces the expiry.

## Conflicts

Writes that are not collaborative use optimistic concurrency:

1. `updateNote` sends `If-Match`.
2. If the server row changed, a 412 comes back with the current server row.
3. `state/mergeNote.ts` does a 3-way merge of (base, desired, current), and tries again one time.

Scalars are client-wins. `tags`, `images` and `linkPreviews` merge item by item. Thus, if two
devices add different tags, the note keeps both, and a removal still removes. If you add an array
field to `Note`, add it to `mergeNoteUpdate`. The default is client-wins. For an array, that
silently deletes the additions of the other writer.
