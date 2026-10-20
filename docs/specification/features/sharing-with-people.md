# Sharing Notes with People

In connected mode, the owner of a note can share it with other accounts on the same server. Each
person who has the note **can edit** it, and collaborate on it live, or **can view** it. The note
arrives only after they accept the invitation.

This is not the same as [sharing a note via URL](sharing.md), which copies a note into a link that all
persons can open, and needs no server. Open mode has no accounts, and none of the functions below.

## Roles

| | Owner | Can edit | Can view |
|---|---|---|---|
| Read the note, see live changes | Yes | Yes | Yes |
| Change title, text, font, images, link previews | Yes | Yes, live over `/api/v1/yjs` | No |
| Their own color, pin, archive, position, tags and reminder | Yes | Yes | Yes |
| Invite people, change roles, remove people | Yes | No | No |
| Trash, restore or delete the note for all persons | Yes | No | No |
| Put the note in their own trash, restore it, empty it from there | Yes | Yes | Yes |
| Remove the note from their own notes | No | Yes | Yes |

A note has one owner, the account that created it. The owner never changes.

## What is shared and what is personal

The **note itself** is the same for all persons: `title`, `content`, `font`, `images` and
`linkPreviews`.

**How a person keeps it** belongs to that person: `color`, `pinned`, `archived`, `trashed`,
`position`, `tags` and `reminder`. If a recipient pins the note, gives it a tag, archives it or puts
it in their trash, nothing changes for the other persons. Thus, each user has their own tags, as in
all other parts of connected mode.

A recipient starts with the color of the note at the time when they accept. The note is not pinned,
not archived, and has no tags and no reminder. It is at the start of their manual order, as their own
new note is.

The trash of the owner is different from the trash of the other persons. See [Trash](#trash) below.

## Inviting

The owner opens **Share with people** from the menu of the note (card, editor, or read-only view).
When a note is shared, the owner can also open it from the row under an open note. That row shows all
other persons on the note, with their names. Pending invitations there are faded, and only the owner
sees them. The row of a recipient names the owner, and opens the same dialog as **People** in their
menu. The command is not available for an automatic note, which a plugin writes again in the browser
of its owner, or for a note in the trash.

The dialog lists the owner and all persons who have the note. For each person, the owner can select
**Can edit** or **Can view**, or remove them. Pending invitations have the mark **Invited**. The owner
can withdraw them in the same way.

To invite a person, the owner does these steps:

1. Look for the person.
2. Select a role.
3. Select **Invite**.

A server setting, `USER_LOOKUP`, controls the search:

| `USER_LOOKUP` | The owner types | Matches | Shows |
|---|---|---|---|
| `exact` *(default)* | A full username or email, then **Find** | Only an account with exactly that username or address (case-insensitive) | Name and username, never the address |
| `search` | Any part of a name | Username, display name or email address that contains it, while the owner types | Name, username and email |

`exact` is the default, because the list of accounts is private unless the operator decides
differently. Nobody can look through it. If you know the username of a person, you do not learn their
address. `search` is correct for a team whose members know each other, on a server where only its
members have accounts. With it, all persons who can sign in can collect all addresses on the server,
ten at a time. Thus, do not use it on a server where all persons can register. Both settings exclude
the person who searches, and both have the same rate limits as the remaining API.

## Accepting

An invitation gives no rights. Until the recipient accepts it, they cannot open, list, search or join
the note.

Invitations show above the grid in the Notes view of the recipient, immediately if they are signed
in. Each invitation shows the name of the owner and the role. Below that is the note, as its card
shows it: the title and the rendered text in the color of the owner and the font of the note. The
checkboxes cannot be ticked yet. A long note is cut off with a fade. Attachments and link previews
arrive with the note after the recipient accepts it.

- **Accept** adds the note to their notes.
- **Decline** removes the invitation, and tells the owner. After a decline, the owner can invite the
  same person again.

## Leaving and removal

A recipient lets go of a note when they delete it, as for their own note. It goes to their trash.
**Delete permanently** there, or 30 days in the trash, removes it from their notes. They can also
select **Remove from my notes** immediately in the dialog "People with this note". The dialog asks
first, because only a new invitation brings the note back. In both cases, the note stays with its
owner and all other persons.

When the owner removes a person, or the person leaves, the note goes out of their grid immediately.
Their open editor closes, and the collaboration socket stops to accept their edits.

## Teams

You can also share a note with a team. The app then invites each member, as if one by one.

- **Where teams come from**: an admin makes them and selects their members (**Teams** in the admin
  view). Or, with single sign-on and `OIDC_TEAM_GROUPS` set, a team mirrors a group at the identity
  provider. The server makes a mirrored team the first time that a person in the group signs in. Its
  members follow the group at each sign-in. An admin can delete it, but cannot change its members.
- **Who can share with a team**: only its members, and only the owner of the note, as for a share
  with one person. The dialog shows the owner only their own teams. A person who is in no team sees
  no team section. Nobody learns about teams that they are not in.
- **Members get invitations**. Each member accepts or declines separately. Each invitation tells
  through which team it came. The owner never gets an invitation to their own note.
- **Joining and leaving follow the team**: a person who joins a team gets invitations to the notes
  shared with it. A person who leaves loses the notes that came to them through it. Only these undo a
  decline or a leave: the person joins the team again, or the owner shares the note with the team
  again.
- **The role of the team is the role of its members**: a change of the role changes their role. When
  the owner stops the share with the team, all persons who had the note through the team lose it.
- **Direct shares win**: a person who has a direct share keeps their own role, and keeps the note when
  the team share goes. If the owner invites a person directly who already has the note through a
  team, their share becomes a direct share.
- **Two teams, one share**: a person who has the note through two teams has it one time, through the
  first team. When that team lets go, the share moves to the other team, with its role.
- **Deleting a team** first removes its notes from its members, in the same way.

In the People list of the note, a member who has it through a team shows "through {team}".

## Trash

Each person has their own trash. A shared note can be in any of them.

- **The trash of the owner** hides the note from all persons with whom the owner shared it. It also
  hides all pending invitations, while the note stays there. A restore brings both back. A permanent
  deletion, directly or through the 30-day expiry, removes the note and its shares permanently.
- **The trash of a recipient** belongs only to that recipient, also for viewers. It is part of how
  they keep the note, as its pin or archive. The note stays in the notes of all other persons, and
  continues to get changes. A restore brings it back to their notes. A permanent deletion, directly
  or through the same 30-day expiry, removes their share and nothing else, as a leave does.

A recipient cannot put the note in the trash of the owner, or delete it for other persons.

## Live updates

Each change to a shared note, by any person, goes to each participant over `/api/v1/ws` as their own
copy, with their personal fields and their role. See
[API](../api.md#application-socket-apiv1ws).

- Editors join the Yjs document of the note on `/api/v1/yjs`, and see the cursors of each other. See
  [Collaborative Editing](collaborative-editing.md).
- Viewers never join the document. They read the note as it is saved. This occurs within one second
  after an editor types.
- Presence (who looks at the note) goes to all persons who can see it, and only to them. A person who
  accepts a note, or gets it back when its owner restores it from the trash, sees immediately who is
  already on it. A tab that opens while they are on it does the same.

A change of role, a removal, or a trash by the owner closes the collaboration socket of the affected
person. The provider reconnects, and the server refuses the note that they cannot edit now.

## Concurrency

A shared note has one `updatedAt`. Each write from each participant sets it, also a change by a
recipient to their own tags. Thus, `If-Match` works the same for all persons. A stale write gets `412`
with the current copy of the note for the writer. The 3-way merge of the client tries again, as for
one user.

## Comments

All persons on a shared note can talk about it in comments adjacent to it. An open shared note shows
a line under its people that tells how many comments it has. When you select it, the comments open,
oldest first, with a field to add one. On a wide screen (64rem and larger), they open in their own
panel to the right of the note, with the same height. Thus, a long thread does not change the note.
On a narrower screen, they open under the line.

- **Adjacent to the note, not in it.** A comment is not part of the text of the note, its
  [versions](version-history.md), its `updatedAt` or its export. A comment changes nothing that a
  card shows. Comments are plain text, up to 2000 characters. A note can have a maximum of 500.
- **Who writes.** The owner, editors and viewers. A comment lets a person who cannot change a note
  say something about it. A note that has no other persons on it has no comments panel.
- **Editing and deleting.** Only the author can edit a comment. It then shows "edited". The author or
  the owner of the note can delete it, after a confirmation.
- **When a person goes.** A person whose share is removed, who leaves the note, or whose account is
  deleted, keeps nothing of the thread. They cannot read it after that. Their comments stay for all
  persons still on the note. They show as "Former participant", with no name, and the owner can
  delete them. The name is removed when the comments are read, from the persons who have the note at
  that time. Thus, nothing is written again. If the owner shares with the person again, their name
  comes back.
- **Trash and deletion.** While the note is in the trash of its owner, only the owner can reach its
  comments, as for the note. When the note is deleted, its comments are deleted.
- **Live.** A comment that is written, edited or deleted goes to all persons on the note over
  `/api/v1/ws` (`comment:created`, `comment:updated`, `comment:deleted`). Thus, an open panel shows
  the changes. An open panel reads its comments again after a lost connection, and when the persons on
  the note change. Thus, the names follow who is on it. If the panel cannot read them, it tells you
  and offers to try again.
- **With sharing off** (`SHARING=off`), you can still read and delete existing comments. You cannot
  write or edit comments.

The server stores comments in `note_comments`. The client loads them only when a shared note opens.
Thus, the board and its listings contain no comments. A card does not show if a note has comments.

## Accounts that go away

When an account is deleted, the notes that it owns are deleted. They go out of the notes of all
persons with whom they were shared, immediately. When an account that was a recipient is deleted,
it goes off the notes that it had.

## Email addresses

Accounts have an optional email address. The app uses it only to find people for a share. The app
never sends mail to it. See [Account Administration](accounts.md#email-addresses).
