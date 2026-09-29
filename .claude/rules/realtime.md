---
paths:
  - "packages/client/src/realtime/**"
  - "packages/client/src/state/mergeNote.ts"
  - "packages/client/src/state/notesStore.ts"
  - "packages/client/src/state/pendingWrites.ts"
  - "packages/client/src/state/incomingNote.ts"
  - "packages/client/src/state/signOut.ts"
  - "packages/client/src/components/ConnectionStatus.tsx"
  - "packages/server/src/ws/**"
  - "packages/server/src/routes/sync*.ts"
---

# Realtime and Conflict Resolution

Server mode runs two sockets, and they carry different things. `realtime/appSocket.ts` holds
`/api/ws` (note events and presence) and reconnects with exponential backoff to a 30s ceiling.
Every reconnect *after the first* catches up through `syncNotes`, because writes made on another
device while this tab was offline arrive nowhere else. It asks `GET /api/sync` for what changed since
the checkpoint `loadNotes` left, and drops a held note missing from the returned ids only if it was
held before the request went out. A membership change stamps `notes.members_changed_at`, never
`updated_at` (the `If-Match` token), so a new way of joining or leaving a note must stamp it in both
drivers or recipients' devices never hear of it (`storage/contracts/syncContract.ts`).
`realtime/yjsProvider.ts` holds `/api/yjs`, one `HocuspocusProvider` per open note, with
`y-indexeddb` underneath so an offline edit survives a reload. Those copies outlive the session, so the account menu signs out through `signOut`
(`state/signOut.ts`), which deletes them (`realtime/localNoteCopies.ts`, plain IndexedDB so the
entry stays free of Yjs); the notes list itself empties on any end of a session, a 401 included. Its `synced` flag is a correctness gate, not a spinner; see Collaborative binding in `editor.md`.

Being resumed is a reason to skip the backoff. A frozen page comes back to a socket the browser
closed for it, and to a backoff its throttled retries may have grown to the ceiling, so a
`visibilitychange` back to visible (and an `online` event) dials at once and resets the backoff. It
dials for a socket in `CLOSED` as well as a missing one, because a resume can deliver the visibility
change before the queued close event, and for one that has gone silent. A socket that dies with no
close stays `OPEN` to both ends, so the server pings every `APP_SOCKET_HEARTBEAT_MS` and terminates
a peer that did not answer the last one, and sends a `heartbeat` event, since a page cannot see
pings. The client gives up on a socket after two and a half beats without a word, but only once it
has heard a heartbeat, so an older server's quiet socket is not redialled forever. The token effect
in `startAppSocket` runs its work `untracked`: `setStatus` reaches code that reads signals, and a
tracked read there re-runs the effect and tears the socket down. The user side of the same
moment is `realtime/connectionOutage.ts`: the banner reports `connectionOutage`, which is `connectionStatus` after a delay, never the status
itself, or every resume announces a reconnect that is already finishing. A deliberate teardown
(`disconnect`, so a logout or open mode) is `idle` rather than `closed` for that reason, and the
delay is armed once per outage, not once per status write, since `connecting` and `closed` alternate
all the way through one.

Non-collaborative writes use optimistic concurrency: `updateNote` sends `If-Match`, and a 412 comes
back carrying the current server row. `state/mergeNote.ts` then does a 3-way merge of
(base, desired, current) and retries once. Scalars are client-wins; `tags`, `images` and
`linkPreviews` merge per item, so two devices adding different tags keep both and a removal still
removes. Adding an array field to `Note` means teaching `mergeNoteUpdate` about it. The default is
client-wins, which for an array silently discards the other writer's additions.
