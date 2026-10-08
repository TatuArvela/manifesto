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

Connected mode lets an owner share a note with other accounts, each as `edit` or `view`, once they
accept an invitation (spec: `docs/specification/features/sharing-with-people.md`). The note row is
the owner's; each recipient's `note_shares` row holds their role and their own `color`, `pinned`,
`archived`, `trashed`, `position`, `tags` and `reminder`. A recipient's trash is theirs alone and
expires their share, not the note; the owner's trash hides the note from everyone. `SHARED_NOTE_FIELDS` / `PERSONAL_NOTE_FIELDS` in
`@manifesto/shared` are the one list of which is which, read by the server's `splitChanges`
(`storage/shareMapping.ts`) and the client's `refusalFor` (`state/notesStore.ts`). Adding a field to
`Note` means putting it in one of them, or recipients cannot write it at all.

Every write by anyone stamps the note's `updated_at`, a recipient's pin included, so all participants
share one `If-Match` token and a listing merges own and shared notes in one `(updatedAt, id)` order.
Every note and invitation event (`note:created`, `note:updated`, `note:deleted`,
`invitation:created`, `invitation:removed`) goes out through `sharing/noteEvents.ts`, never
`broadcaster.emit` with the writer's copy: each participant sees different personal fields and a
different `sharing.role`, and the sockets and webhooks both hear what the broadcaster carries.
`biome-plugins/noteEvents.grit` refuses one of those events built anywhere else. Anything that takes a note
away from someone (removal, a role drop to `view`, the owner trashing it) also goes through
`sharing/accessChanges.ts`, for the same reason as `endUserSessions`: sockets authorized at connect
stay open otherwise. A viewer never joins `/api/yjs`; `onAuthenticate` refuses them.
`storage/contracts/sharingContract.ts` runs the rules against both drivers.

Comments (`routes/comments.ts`, `note_comments`) sit beside a shared note and never touch it: no
`updated_at` stamp, no version, no `note:updated`. Their events go out through `noteEvents.commented`,
to everyone who can see the note. An author who is no longer on the note is left off when comments are
read (`author: null`, "Former participant" in the client), decided from the note's audience on every
read rather than written into the row, so removing a share needs no cleanup and sharing again restores
the name. Anything new that lists people on a note has to make the same choice.

The client holds a note's comments only while its panel is up (`state/comments.ts`), and one read is
never the last word: `loadComments` is run again by the socket's reconnect catch-up (`reloadComments`),
by a change in who is on the note (the held names are only as fresh as the read), by an event that
arrives while a read is under way, and by the panel's "Try again" after a failed one. An answer for a
panel that has gone, or older than a later read of the same note, is dropped.

A share to a team (spec: the Teams section of the same file) expands into one ordinary `note_shares`
row per member, marked with `via_team`, so every access check keeps reading `note_shares` alone.
`sharing/teamShares.ts` is the only code that understands teams: sharing, a team's role, members
joining and leaving (admin edits, and `syncOidcTeams` at an OIDC sign-in) all go through it. A direct
share is never touched by a team, and a share that loses its team passes to another the member is in
before it is removed.
