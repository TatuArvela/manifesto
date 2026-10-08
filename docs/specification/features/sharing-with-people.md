# Sharing Notes with People

In connected mode a note's owner can share it with other accounts on the same server. Each person the note is shared with either **can edit** it, collaborating on it live, or **can view** it. The note arrives only once they accept the invitation.

This is separate from [sharing a note via URL](sharing.md), which copies a note into a link anyone can open and needs no server. Open mode has no accounts and none of what follows.

## Roles

| | Owner | Can edit | Can view |
|---|---|---|---|
| Read the note, see live changes | Yes | Yes | Yes |
| Change title, text, font, images, link previews | Yes | Yes, live over `/api/yjs` | No |
| Their own color, pin, archive, position, tags and reminder | Yes | Yes | Yes |
| Invite people, change roles, remove people | Yes | No | No |
| Trash, restore or delete the note for everyone | Yes | No | No |
| Put the note in their own trash, restore it, empty it from there | Yes | Yes | Yes |
| Remove the note from their own notes | No | Yes | Yes |

A note has one owner, the account that created it, and ownership never changes.

## What is shared and what is personal

The **note itself** is the same for everyone: `title`, `content`, `font`, `images` and `linkPreviews`.

**Everything about how a person keeps it** is their own: `color`, `pinned`, `archived`, `trashed`, `position`, `tags` and `reminder`. A recipient pinning the note, filing it under a tag, archiving it or putting it in their trash changes nothing for anyone else. This is what keeps tags per-user, as they are everywhere else in connected mode.

A recipient starts with the note's color at the moment they accept, unpinned, unarchived, without tags or a reminder, and at the head of their manual order, as a note of their own would be.

The owner's trash is different from everyone else's. See [Trash](#trash) below.

## Inviting

The owner opens **Share with people** from the note's menu (card, editor, or read-only view), or once a note is shared, from the row under an open note that shows everyone else on it with their names; pending invitations there are faded, and only the owner sees them. A recipient's row names the owner and opens the same dialog as **People** in their menu. It is not offered for an automatic note, which a plugin rewrites in its owner's browser, or for a note in the trash.

The dialog lists the owner and everyone the note is shared with. For each person the owner can pick **Can edit** or **Can view**, or remove them. Pending invitations are marked **Invited** and can be withdrawn the same way.

To invite someone, the owner looks them up, picks a role, and chooses **Invite**. How the lookup works is a server setting, `USER_LOOKUP`:

| `USER_LOOKUP` | The owner types | Matches | Shows |
|---|---|---|---|
| `search` *(default)* | Any part of a name | Username, display name or email address containing it, as they type | Name, username and email |
| `exact` | A whole username or email, then **Find** | Only an account with exactly that username or address (case-insensitive) | Name and username, never the address |

`search` suits a team that knows each other. `exact` is for a server where the list of accounts is nobody's business: nobody can browse it, and knowing someone's username does not reveal their address. Both leave out the person searching and are rate-limited like the rest of the API.

## Accepting

An invitation grants nothing: until it is accepted, the recipient cannot open, list, search, or join the note.

Invitations appear above the grid in the recipient's Notes view, live if they are signed in, with the owner's name and the role. Below that is the note itself as its card would show it: title and rendered text in the owner's color and the note's font, with checkboxes that cannot be ticked yet, cut off with a fade when it runs long. Attachments and link previews arrive with the note once accepted. **Accept** adds the note to their notes; **Decline** removes the invitation and tells the owner. An owner can invite the same person again after a decline.

## Leaving and removal

A recipient lets go of a note by deleting it, as they would a note of their own: it goes to their trash, and **Delete permanently** there, or 30 days in it, takes it out of their notes. They can also **Remove from my notes** straight away from the People with this note dialog, which asks first, since only a new invitation brings it back. Either way the note stays with its owner and everyone else.

When the owner removes someone, or they leave, the note disappears from their grid at once, their open editor closes, and the collaboration socket stops accepting their edits.

## Teams

A note can also be shared with a team, and each member is then invited to it as if one by one.

- **Where teams come from**: an admin makes them and chooses their members (**Teams** in the admin
  view), or, with single sign-on and `OIDC_TEAM_GROUPS` set, a team mirrors a group at the identity
  provider. A mirrored team is made the first time someone in the group signs in, and its members
  follow the group at every sign-in; an admin can delete it but not change its members.
- **Who may share with a team**: its members only, and the owner of the note alone, as for sharing
  with one person. The dialog offers the owner only their own teams, and shows no team section to
  someone in none; nobody learns of teams they are not in.
- **Members get invitations**, each accepted or declined on its own, and each saying which team it
  came through. The owner is never invited to their own note.
- **Joining and leaving follow**: someone who joins a team is invited to the notes shared with it, and
  someone who leaves loses the ones that reached them through it. Declining or leaving a note is not
  undone by anything but joining the team again, or the note being shared with the team again.
- **The team's role is its members'**: changing it changes theirs, and stopping sharing with the team
  takes the note from everyone who had it through the team.
- **Direct shares win**: someone the note was shared with directly keeps their own role, and keeps
  the note when the team share goes. Inviting someone directly who already has the note through a
  team makes their share a direct one.
- **Two teams, one share**: someone who has the note through two teams holds it once, through the
  first; when that one lets go, the share passes to the other, with its role.
- **Deleting a team** takes its notes from its members first, the same way.

In the note's People list, a member who has it through a team is shown "through {team}".

## Trash

Everyone has a trash of their own, and a shared note can be in any of them.

- **The owner's trash** hides the note from everyone the owner shared it with, and withdraws any pending invitations from view, for as long as it stays there. Restoring it brings both back. Deleting it permanently, directly or through the 30-day expiry, removes the note and its shares for good.
- **A recipient's trash** is theirs alone, viewers included: it is part of how they keep the note, like its pin or archive. The note stays in everyone else's notes and keeps receiving changes. Restoring it brings it back among their notes; deleting it permanently, directly or through the same 30-day expiry, removes their share and nothing else, as leaving does.

A recipient cannot put the note in the owner's trash or delete it for anyone but themselves.

## Live updates

Every change to a shared note, by anyone, reaches every participant over `/api/ws` as their own copy of it, with their personal fields and their role. See [API](../api.md#application-socket-apiws).

- Editors join the note's Yjs document on `/api/yjs` and see each other's cursors. See [Collaborative Editing](collaborative-editing.md).
- Viewers never join the document. They read the note as it is saved, which happens within a second of an editor typing.
- Presence (who is looking at the note) reaches everyone who can see it, and only them. Someone who accepts a note, or regains it when its owner restores it from the trash, sees at once who is already on it, as does a tab that opens while they are.

A change of role, a removal, or the owner trashing the note closes the affected person's collaboration socket. The provider reconnects, and the server refuses the note they may no longer edit.

## Concurrency

A shared note has one `updatedAt`, stamped by every write from every participant, including a recipient's change to their own tags. `If-Match` therefore works the same for everyone: a stale write gets `412` with the writer's own current copy of the note, and the client's 3-way merge retries as it does for a single user.

## Comments

Everyone on a shared note can talk about it beside it. An open note that is shared shows a line under
its people saying how many comments it has; choosing it opens them, oldest first, with a field to add one.

- **Beside the note, not in it.** A comment is not part of the note's text, its
  [versions](version-history.md), its `updatedAt` or its export, and writing one changes nothing a card
  shows. Comments are plain text, up to 2000 characters, and a note holds at most 500.
- **Who writes.** The owner, editors and viewers alike: a comment is how someone who cannot change a note
  says something about it. A note nobody else is on has no comments panel.
- **Editing and deleting.** A comment is edited by its author only, and then says "edited". It is deleted
  by its author or by the note's owner, after a confirmation.
- **When someone goes.** A person whose share is removed, who leaves the note, or whose account is
  deleted keeps nothing of the thread: they can no longer read it. Their comments stay for everyone still
  on the note, shown as "Former participant" with no name, and the owner can delete them. The name is
  left off when the comments are read, from who holds the note at that moment, so nothing is rewritten:
  sharing with the person again brings their name back.
- **Trash and deletion.** While the note is in its owner's trash only the owner reaches its comments,
  as with the note. Deleting the note deletes its comments.
- **Live.** A comment written, edited or deleted reaches everyone on the note over `/api/ws`
  (`comment:created`, `comment:updated`, `comment:deleted`), so an open panel follows along.
  An open panel reads its comments again after the connection was lost, and when the people on the
  note change, so names follow who is on it. If they cannot be read the panel says so and offers to
  try again.
- **With sharing off** (`SHARING=off`), comments already written are still read and can still be deleted;
  none can be written or edited.

Comments are stored in `note_comments` and loaded only when a shared note is opened, so the board and
its listings carry none of them. A card does not show that a note has comments.

## Accounts that go away

Deleting an account deletes the notes it owns, which removes them from everyone they were shared with, live. An account that was a recipient simply drops off the notes it held.

## Email addresses

Accounts have an optional email address, used only to find people when sharing. Nothing is ever sent to it. See [Account Administration](accounts.md#email-addresses).
