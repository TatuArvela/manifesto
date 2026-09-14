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
| Trash, restore or delete the note | Yes | No | No |
| Remove the note from their own notes | No | Yes | Yes |

A note has one owner, the account that created it, and ownership never changes.

## What is shared and what is personal

The **note itself** is the same for everyone: `title`, `content`, `font`, `images` and `linkPreviews`.

**Everything about how a person keeps it** is their own: `color`, `pinned`, `archived`, `position`, `tags` and `reminder`. A recipient pinning the note, filing it under a tag or archiving it changes nothing for anyone else. This is what keeps tags per-user, as they are everywhere else in connected mode.

A recipient starts with the note's color at the moment they accept, unpinned, unarchived, without tags or a reminder, and at the end of their manual order.

The trash belongs to the owner. See [Trash](#trash) below.

## Inviting

The owner opens **Share with people** from the note's menu (card, editor, or read-only view). It is not offered for an automatic note, which a plugin rewrites in its owner's browser, or for a note in the trash.

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

A recipient can **Remove from my notes** from the note's menu, in place of Delete. The dialog asks first, since only a new invitation brings it back. The note stays with its owner and everyone else.

When the owner removes someone, or they leave, the note disappears from their grid at once, their open editor closes, and the collaboration socket stops accepting their edits.

## Trash

Trashing a note hides it from everyone the owner shared it with, and withdraws any pending invitations from view, for as long as it stays in the trash. Restoring it brings both back. Deleting it permanently, directly or through the 30-day expiry, removes it and its shares for good.

A recipient cannot trash a shared note: there is no trash of theirs for it to go to, and the owner's is not theirs to use.

## Live updates

Every change to a shared note, by anyone, reaches every participant over `/api/ws` as their own copy of it, with their personal fields and their role. See [API](../api.md#application-socket-apiws).

- Editors join the note's Yjs document on `/api/yjs` and see each other's cursors. See [Collaborative Editing](collaborative-editing.md).
- Viewers never join the document. They read the note as it is saved, which happens within a second of an editor typing.
- Presence (who is looking at the note) reaches everyone who can see it, and only them. Someone who accepts a note, or regains it when its owner restores it from the trash, sees at once who is already on it, as does a tab that opens while they are.

A change of role, a removal, or the owner trashing the note closes the affected person's collaboration socket. The provider reconnects, and the server refuses the note they may no longer edit.

## Concurrency

A shared note has one `updatedAt`, stamped by every write from every participant, including a recipient's change to their own tags. `If-Match` therefore works the same for everyone: a stale write gets `412` with the writer's own current copy of the note, and the client's 3-way merge retries as it does for a single user.

## Accounts that go away

Deleting an account deletes the notes it owns, which removes them from everyone they were shared with, live. An account that was a recipient simply drops off the notes it held.

## Email addresses

Accounts have an optional email address, used only to find people when sharing. Nothing is ever sent to it. See [Account Administration](accounts.md#email-addresses).
