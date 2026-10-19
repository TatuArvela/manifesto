# Privacy

Who can read what someone writes in Manifesto, and what they can find out when they do. The short
version: in open mode nobody but the person at the device; in connected mode the operator of the
server can, admins cannot from inside the app unless the server is set up to let them, and anything an
admin does to an account shows on that account's own Activity page.

This page describes the software. A deployment's operator decides the rest (who is an admin, where the
database and its backups live, which settings are on), so a user of someone else's server trusts that
operator, not only the code.

## Who can read notes

| Mode | Who can read notes |
|---|---|
| **Open mode** | Whoever can use the browser profile they are in. Nothing leaves the device. |
| **Connected, own server** | Its operator, which is the user. |
| **Connected, someone else's server** | The people a note is [shared with](sharing-with-people.md). The operator and the admins hold what the browser sealed and no key that opens it. |

Notes are being moved to end-to-end encryption: [Encryption](encryption.md) has the design, and
says which parts are built. Everything a person writes in a note (its title, text, tags, colour,
images, the shared document it is edited in, its versions and comments) is sealed in the browser
before it reaches the server. That is built but not yet released; until a release carries it,
anyone who needs notes the server cannot read should use open mode, or run their own server.

## What an admin can see

An [admin](accounts.md) administers accounts, not their contents. From inside the app an admin sees:

- **Every account**: username, display name, email address, whether it is an admin, how it signs in,
  its note count, when it was created and last seen.
- **The overview**: totals, and per account the number of notes, shares, images, the bytes they take
  and saved versions. Counts, never contents.
- **The audit log**: who did what to which account or note, when, and from which address. It records
  that a note was shared, never what the note says.

An admin does not see the notes themselves: no view, route or search in the app reads another
account's notes, and the server has nothing readable to hand over. There is no export of another
account's notes; a person exports their own from the app. One action comes close, and it is visible
to the account's owner:

- **Issuing a temporary password** (local sign-in only). An admin who used it to sign in as someone
  would first have to choose a new password, which signs the owner out everywhere, turns off their
  two-factor sign-in and removes their passkeys, and leaves their own password not working. It is recorded as
  `admin.password_reset`.

## What other users can see

Someone sharing a note looks the other person up, and what that lookup shows is `USER_LOOKUP`
([Sharing with people](sharing-with-people.md#inviting)). Under `exact`, the default, it finds an
account only by its whole username or email address and never shows the address, so the list of
accounts cannot be browsed. Under `search` it suggests accounts as the owner types, with their email
addresses, so anyone who can sign in can collect every address on the server. That suits a team whose
members all know each other, and no server where anyone may register.

Beyond that, someone on a note sees the names of the others on it, and the names on its comments.

## What a user can see about their account

Settings has an **Activity** page for every signed-in user (`GET /api/v1/auth/me/activity`): the audit
log's lines where they are the actor or the target, newest first. That is their sign-ins and failed
ones, changes to how the account is secured, shares with and by them, and every admin action on their
account, a download of their notes included, with the admin's name. The rule is that what an admin
can see about someone, that person can see too.

- **Addresses** are shown for what the user did themselves and for failed sign-ins on their account,
  since those are the ones they may want to recognise. Where someone else acted on them (an admin, a
  person sharing a note) the entry names who, but not from where.
- **Only with a session.** An [API token](../api.md) cannot read it, as it cannot read anything else
  about how the account is secured.
- **Kept as long as the log is**: `AUDIT_RETENTION_DAYS`, 180 days by default. An admin cannot delete
  single entries from the app.

## What the operator holds

Everything the server stores is readable by whoever runs it:

- **Notes**, their [version history](version-history.md), [attachments](attachments.md) and the
  shared document state of [collaborative editing](collaborative-editing.md).
- **Accounts**: usernames, display names, email addresses, the language each client is set to, and
  password hashes (argon2). Sessions and API tokens are stored as hashes.
- **Preferences** that follow the account ([Preferences](preferences.md)), which include the names
  of tags hidden from the board.
- **The audit log**, with client addresses. A failed sign-in names the account it was for only when
  the name tried belongs to one: a name that matched no account is not kept, since it is often a
  password typed into the wrong field.
- **Backups**, when `BACKUP_INTERVAL_HOURS` is set: whole copies of all of the above, in `BACKUP_DIR`,
  the newest `BACKUP_KEEP` of them.

How long each is kept:

| What | Kept |
|---|---|
| An account and what it holds | Until it is deleted, by its owner or an admin |
| A note in the trash | 30 days ([Trash](trash.md)) |
| A note's versions | The newest 50, and none older than 90 days |
| An image no note refers to | 90 days, so a restored version still finds it |
| A session, a sign-in or reset link, an API token | Until it expires or is ended, then swept within the hour |
| An audit log entry | `AUDIT_RETENTION_DAYS`, 180 days by default, also after the account it is about is deleted |
| A backup | Until `BACKUP_KEEP` newer ones replace it, also after an account in it is deleted |

## A person's own data

What a person can do about what the server holds on them, without asking anyone:

- **See it.** Settings shows the account's details, its tokens, webhooks and passkeys, and its
  **Activity** page shows the audit log's lines about it ([above](#what-a-user-can-see-about-their-account)).
- **Take it away.** **Export Notes** downloads every note the account owns, with versions and
  preferences, in a format that imports anywhere ([Export](export-import.md#export)). Notes shared with
  the account are their owners', and comments it wrote stay with the notes they were written on.
- **Correct it.** The email address is changed on the Account page; under single sign-on it comes from
  the identity provider.
- **Delete it.** **Delete account** on the Account page removes the account and everything it holds
  ([Accounts](accounts.md#deleting-your-own-account)). What stays is the audit log's entries until they
  expire and the backups taken before, as the table above says.

## The operator's privacy notice

Whoever runs a server for other people decides who holds their data and for how long, and is the one
to tell them. `VITE_PRIVACY_URL`, or the `privacy-url` meta tag in a release bundle
([Client Deployment](../client/deployment.md)), links that notice from the sign-in screen, where an
account is made, and from About. This page is a starting point for writing it: the settings that
change what it has to say are `USER_LOOKUP`, `REGISTRATION_ENABLED`, `AUDIT_RETENTION_DAYS`,
`BACKUP_INTERVAL_HOURS` and `BACKUP_KEEP`, `TRUST_PROXY` (whose addresses the audit log records),
and the features that reach third parties, below.

The server's own log carries method, path, status and timing, never a request body or a query string,
so what someone searches for is not logged. Encryption at rest is whatever the operator's disk or
database provides.

## What reaches third parties

- **Push reminders** (connected mode, `WEB_PUSH` on by default): a reminder nobody's open app fired is
  sent through the browser's push service, which is Google's, Apple's or Mozilla's according to the
  browser. The service learns that this server sent that browser a message, when, and how large; the
  note's title and first words inside it are encrypted to the browser and it cannot read them. Nothing
  is sent for an account with no subscribed browser.
- **Link previews** (connected mode, `LINK_PREVIEWS` on by default): the server fetches the pages a
  note links to. Those sites see the server's address, not the user's, and the URL, not the note.
  Open mode never does this; its CSP forbids it.
- **Webhooks**: a user's own [webhooks](webhooks.md) post note events to the URLs they chose.
- **AI assistants**: whatever a user's own assistant reads through the [MCP endpoint](mcp.md) goes
  wherever that assistant runs, usually its vendor's service. Only a token the user minted opens it.
- **Mail**, with `SMTP_URL` set: password reset links and share invitations go through that relay.
- **The update check** (`UPDATE_CHECK`): the server asks GitHub for the newest release. It sends
  nothing about users or notes.
- **Share links** ([Sharing](sharing.md)) carry the note in the URL fragment, which the browser does
  not send to any server; whoever holds the link can read the note.
- **Public links** ([Sharing](sharing.md#public-links)) let anyone holding one read the note it
  publishes, with no account, until it expires, is used up or is revoked. The server counts the views
  and keeps the time of the last one, and nothing about who viewed.

## On the device

- **Open mode** keeps everything in `localStorage` and IndexedDB, as private as the browser profile.
- **Connected mode** keeps the notes in memory, and an offline copy of each note opened for editing in
  IndexedDB (`manifesto:yjs-sealed:<id>`), so an edit made offline survives a reload. The copy is
  the sealed log of the note's edits, as the server holds it. A browser that kept readable copies
  before notes were sealed (`manifesto:yjs:<id>`) deletes them the next time a note is opened.
- **Notes not stored yet.** The new-note composer's draft, and new notes written while the server
  could not be reached, are kept in IndexedDB (`manifesto-offline`) until they are saved and sent.
  In connected mode each is sealed under a key derived from the account key and bound to the
  account, so it is as unreadable on the device as the offline copies; in open mode it is kept
  readable, as the notes are.
- **Signing out** leaves none of the account's notes behind: the list leaves memory, the reminders
  stop (in the page and in the service worker's copy, which is handed an empty list), and the offline
  copies, the draft and the notes not sent yet are deleted. Signing out with notes not sent asks
  first, since this device is the only place they are. A session that ends because the server
  refused it (`401`) empties the list and stops the reminders too, but keeps the offline copies and
  the notes not sent, since it can arrive with work done offline that has not reached the server
  yet; they are sent once the account is unlocked here again.
- **Preferences** (`manifesto:prefs`) stay after sign-out. They hold settings such as the theme, and
  the names of tags hidden from the board; in connected mode most of them are also the account's,
  kept on the server.
