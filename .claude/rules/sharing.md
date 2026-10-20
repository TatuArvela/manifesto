---
paths:
  - "packages/server/src/sharing/**"
  - "packages/server/src/storage/shareMapping.ts"
  - "packages/server/src/storage/contracts/sharingContract.ts"
  - "packages/server/src/routes/shares*.ts"
  - "packages/server/src/routes/teams*.ts"
  - "packages/server/src/routes/comments*.ts"
  - "packages/server/src/storage/commentMapping.ts"
  - "packages/server/src/storage/contracts/commentsContract.ts"
  - "packages/server/src/storage/**/commentsRepo.ts"
  - "packages/shared/src/api/comments.ts"
  - "packages/client/src/state/comments.ts"
  - "packages/client/src/components/NoteComments.tsx"
  - "packages/client/src/state/sharing.ts"
  - "packages/client/src/state/teams.ts"
  - "packages/client/src/state/incomingShare.ts"
  - "packages/shared/src/note.ts"
  - "docs/specification/features/sharing-with-people.md"
---

# Sharing Between Accounts

In connected mode, an owner can share a note with other accounts. Each account gets `edit` or
`view`, after it accepts an invitation. The specification is
`docs/specification/features/sharing-with-people.md`. The note is sealed, so a share also gives the
key of the note. `encryption.md` tells about that part.

## Shared and personal fields

The note row belongs to the owner. Each recipient has a `note_shares` row. That row contains the
role of the recipient, and the personal values of the recipient: `color`, `pinned`, `archived`,
`trashed`, `position`, `tags` and `reminder`.

- The trash of a recipient belongs only to that recipient. It expires the share, not the note.
- The trash of the owner hides the note from all persons.

`SHARED_NOTE_FIELDS` and `PERSONAL_NOTE_FIELDS` in `@manifesto/shared` are the only list that tells
which field is which. The `splitChanges` of the server (`storage/shareMapping.ts`) and the
`refusalFor` of the client (`state/notesStore.ts`) read it. If you add a field to `Note`, put it in
one of them. If you do not, recipients cannot write it.

## Writes and events

Each write, by any person, sets the `updated_at` of the note. This includes a pin by a recipient.
Thus, all participants share one `If-Match` token, and a listing merges own notes and shared notes
in one `(updatedAt, id)` order.

Each note event and invitation event (`note:created`, `note:updated`, `note:deleted`,
`invitation:created`, `invitation:removed`) goes out through `sharing/noteEvents.ts`. Never send one
with `broadcaster.emit` and the copy of the writer. Each participant sees different personal fields
and a different `sharing.role`. The sockets and the webhooks both receive what the broadcaster
sends. `biome-plugins/noteEvents.grit` refuses one of those events if other code builds it.

All code that takes a note away from a person (a removal, a change of role to `view`, the owner
puts it in the trash) also goes through `sharing/accessChanges.ts`. The reason is the same as for
`endUserSessions`: if not, sockets that got authorization when they connected stay open. A viewer
never joins `/api/v1/yjs`, because `onAuthenticate` refuses viewers.
`storage/contracts/sharingContract.ts` runs the rules against both drivers.

The server counts the invitation mail for each sender and recipient (`INVITATION_MAILS_PER_HOUR` in
`routes/shares.ts`). Each new function that sends mail to a person because a different account asks
for it also needs a limit.

## Comments

Comments (`routes/comments.ts`, `note_comments`) are adjacent to a shared note, and never change
it. They set no `updated_at`, make no version, and send no `note:updated`. Their events go out
through `noteEvents.commented`, to all persons who can see the note.

If an author is no longer on the note, a read of the comments does not show the author
(`author: null`, "Former participant" in the client). Each read decides this from the current
audience of the note. The row does not record it. Thus, the removal of a share needs no cleanup, and
a new share shows the name again. All new code that lists persons on a note must do the same.

The client keeps the comments of a note only while their panel is open (`state/comments.ts`). One
read is never the final data. These run `loadComments` again:

- The catch-up of the socket after a reconnect (`reloadComments`).
- A change of the persons on the note. The names are only as recent as the read.
- An event that arrives during a read.
- "Try again" in the panel, after a failed read.

The client ignores an answer for a panel that is closed, and an answer that is older than a later
read of the same note.

## Teams

A share to a team (see the Teams section of the same specification) becomes one usual `note_shares`
row for each member, with the mark `via_team`. Thus, each access check continues to read only
`note_shares`.

- `sharing/teamShares.ts` is the only code that knows about teams. Shares, the role of a team, and
  members that join or leave (admin edits, and `syncOidcTeams` at an OIDC sign-in) all go through
  it.
- A team never changes a direct share.
- If a share loses its team, it moves to a different team of the member before it is removed.
- The removal of a team has several steps, with no transaction. Thus, code that invites through a
  team (`share`, `joined`) checks after it that the team still exists. That code and the removal
  both end with `settle`. The one that finishes last removes the shares that the other could not
  see.
