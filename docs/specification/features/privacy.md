# Privacy

This page tells who can read what a person writes in Manifesto, and what they can learn when they
read it. The short version: in open mode, only the person at the device. In connected mode, the
people who share a note. The operator and the admins cannot read notes, because the browser seals
notes before they go to the server. All actions of an admin on an account show on the Activity page
of that account.

This page describes the software. The operator of a deployment decides the other parts (who is an
admin, where the database and its backups are, which settings are on). Thus, a user of a server of a
different person trusts that operator, not only the code.

## Who can read notes

| Mode | Who can read notes |
|---|---|
| **Open mode** | The persons who can use the browser profile. Nothing goes off the device. |
| **Connected, own server** | Its operator, who is the user. |
| **Connected, server of a different person** | The people who have the note [shared with](sharing-with-people.md) them. The operator and the admins have what the browser sealed, and no key that opens it. |

All that a person writes in a note (its title, text, tags, color, images, the shared document in
which it is edited, its versions and comments) is sealed in the browser before it goes to the server.
[Encryption](encryption.md) tells the design, what is built, and what it does not protect. The main
items are an operator who changes the client that the server sends, and a request with a token, which
the server opens in memory.

## What an admin can see

An [admin](accounts.md) manages accounts, not their contents. In the app, an admin sees:

- **Each account**: username, display name, email address, if it is an admin, how it signs in, its
  note count, when it was created, and when it was last seen.
- **The overview**: totals, and for each account the number of notes, shares, images, the bytes that
  they use, and saved versions. Only counts, never contents.
- **The audit log**: who did what to which account or note, when, and from which address. It records
  that a note was shared, never what the note says.

An admin does not see the notes. No view, route or search in the app reads the notes of a different
account, and the server has no readable data to give. There is no export of the notes of a different
account. A person exports their own notes from the app. One action is almost an exception, and the
owner of the account can see it:

- **A temporary password** (local sign-in only). If an admin uses it to sign in as a person, the admin
  must first select a new password. This signs the owner out on all devices, turns off their
  two-factor sign-in, removes their passkeys, and their own password stops. The audit log records it
  as `admin.password_reset`.

## What other users can see

A person who shares a note looks for the other person. `USER_LOOKUP` controls what that search shows
([Sharing with people](sharing-with-people.md#inviting)).

- With `exact`, the default, it finds an account only by its full username or email address. It
  never shows the address. Thus, nobody can look through the list of accounts.
- With `search`, it suggests accounts while the owner types, with their email addresses. Thus, all
  persons who can sign in can collect all addresses on the server. That is correct for a team whose
  members all know each other. It is not correct for a server where all persons can register.

Also, a person on a note sees the names of the other persons on it, and the names on its comments.

## What a user can see about their account

Settings has an **Activity** page for each signed-in user (`GET /api/v1/auth/me/activity`). It shows
the lines of the audit log where the user is the actor or the target, newest first. These are their
sign-ins and failed sign-ins, changes to the security of the account, shares with them and by them,
and each admin action on their account, with the name of the admin. The rule: what an admin can see
about a person, that person can also see.

- **Addresses** show for the actions of the user and for failed sign-ins on their account. The user
  possibly wants to identify those. Where a different person acted on them (an admin, a person who
  shared a note), the entry names who, but not from where.
- **Only with a session.** An [API token](../api.md) cannot read it, as it cannot read other data
  about the security of the account.
- **Kept for the same time as the log**: `AUDIT_RETENTION_DAYS`, 180 days by default. An admin cannot
  delete one entry from the app.

## What the operator holds

The operator of the server has all of the data that the server stores. Some of it is sealed, and the
operator has no key for it. The other data is readable:

- **Notes**, their [version history](version-history.md), [attachments](attachments.md), comments
  and the shared document state of [collaborative editing](collaborative-editing.md): sealed.
  [Encryption](encryption.md#what-it-does-not-protect) lists what the server reads about them (which
  exist, who owns them, with whom they are shared, their size, when they changed, their pin, archive
  and trash state, and when a reminder is due).
- **Accounts**: usernames, display names, email addresses, the language of each client, and password
  hashes (argon2). Sessions and API tokens are stored as hashes.
- **Preferences** that go with the account ([Preferences](preferences.md)): sealed, as notes are.
- **The audit log**, with client addresses. A failed sign-in names its account only when the name
  that was tried belongs to an account. The server does not keep a name that matched no account,
  because it is frequently a password typed into the wrong field.
- **Backups**, when `BACKUP_INTERVAL_HOURS` is set: full copies of all of the above, in
  `BACKUP_DIR`. The server keeps the newest `BACKUP_KEEP` of them.

How long the server keeps each item:

| What | Kept |
|---|---|
| An account and its data | Until its owner or an admin deletes it |
| A note in the trash | 30 days ([Trash](trash.md)) |
| The versions of a note | The newest 50, and none older than 90 days |
| An image to which no note refers | 90 days, so that a restored version still finds it |
| A session, a sign-in or reset link, an API token | Until it expires or ends. Then the sweep removes it in one hour |
| An audit log entry | `AUDIT_RETENTION_DAYS`, 180 days by default, also after the deletion of its account |
| A backup | Until `BACKUP_KEEP` newer backups replace it, also after the deletion of an account in it |

## A person's own data

A person can do these things with the data that the server has about them, without a request to
other persons:

- **See it.** Settings shows the details of the account, its tokens, webhooks and passkeys. Its
  **Activity** page shows the lines of the audit log about it
  ([above](#what-a-user-can-see-about-their-account)).
- **Take it away.** **Export Notes** downloads all notes that the account owns, with versions and
  preferences, in a format that you can import anywhere ([Export](export-import.md#export)). Notes
  shared with the account belong to their owners. Comments that it wrote stay with their notes.
- **Correct it.** You change the email address on the Account page. With single sign-on, it comes
  from the identity provider.
- **Delete it.** **Delete account** on the Account page removes the account and all of its data
  ([Accounts](accounts.md#deleting-your-own-account)). The audit log entries stay until they expire,
  and the older backups stay, as the table above tells.

## The operator's privacy notice

The operator of a server for other people decides who has their data and for how long. The operator
must tell them. `VITE_PRIVACY_URL`, or the `privacy-url` meta tag in a release bundle
([Client Deployment](../client/deployment.md)), puts a link to that notice on the sign-in screen,
where accounts are made, and in About. Use this page as a start for the notice. These settings change
what it must say:

- `USER_LOOKUP`
- `REGISTRATION_ENABLED`
- `AUDIT_RETENTION_DAYS`
- `BACKUP_INTERVAL_HOURS` and `BACKUP_KEEP`
- `TRUST_PROXY` (it controls which addresses the audit log records)
- The features that send data to third parties, below.

The log of the server contains the method, path, status and timing. It never contains a request body
or a query string. Thus, the log does not record what a person searches for. Encryption at rest is
what the disk or database of the operator gives. In addition, the browser seals notes. The [server
key](encryption.md#the-server-key) seals some values that the server reads by itself (reminder times,
webhook and authenticator secrets, push keys).

## What reaches third parties

- **Push reminders** (connected mode, `WEB_PUSH` on by default): if no open app fired a reminder, the
  server sends it through the push service of the browser. That service belongs to Google, Apple or
  Mozilla, as the browser decides. The service learns that this server sent a message to that
  browser, when, and its size. The title and first words of the note inside it are encrypted to the
  browser, and the service cannot read them. The server sends nothing for an account with no
  subscribed browser.
- **Link previews** (connected mode, `LINK_PREVIEWS` on by default): the server gets the pages that a
  note links to. Those sites see the address of the server, not of the user, and the URL, not the
  note. Open mode never does this. Its CSP does not permit it.
- **Webhooks**: the [webhooks](webhooks.md) of a user send note events to the URLs that the user
  selected.
- **AI assistants**: what the assistant of a user reads through the [MCP endpoint](mcp.md) goes to
  the place where that assistant runs, usually the service of its vendor. Only a token that the user
  made opens it.
- **Mail**, with `SMTP_URL` set: password reset links and share invitations go through that relay.
- **The update check** (`UPDATE_CHECK`): the server asks GitHub for the newest release. It sends no
  data about users or notes.
- **Share links** ([Sharing](sharing.md)) contain the note in the URL fragment. The browser does not
  send the fragment to a server. All persons with the link can read the note.
- **Public links** ([Sharing](sharing.md#public-links)) let all persons with a link read its note,
  with no account, until it expires, reaches its view limit, or is revoked. The server counts the
  views and keeps the time of the last view. It keeps no data about who looked.

## On the device

- **Open mode** keeps all data in `localStorage` and IndexedDB. It is as private as the browser
  profile.
- **Connected mode** keeps the notes in memory. It keeps an offline copy of each note opened for
  editing in IndexedDB (`manifesto:yjs-sealed:<id>`). Thus, an offline edit stays after a reload. The
  copy is the sealed log of the edits of the note, as the server has it. A browser that kept readable
  copies before notes were sealed (`manifesto:yjs:<id>`) deletes them the next time a note opens.
- **Notes that are not stored yet.** The draft of the new-note composer, and new notes written while
  the server was not available, stay in IndexedDB (`manifesto-offline`) until they are saved and sent.
  In connected mode, each is sealed under a key made from the account key, and bound to the account.
  Thus, it is as unreadable on the device as the offline copies. In open mode, it stays readable, as
  the notes are.
- **Signing out** leaves no notes of the account:
  - The list goes out of memory.
  - The reminders stop, in the page and in the copy of the service worker, which gets an empty list.
  - The app deletes the offline copies, the draft and the notes that were not sent.
  - If there are notes that were not sent, the app asks first, because this device is the only place
    where they are.
- **A session that ends because the server refused it** (`401`) also empties the list and stops the
  reminders. But it keeps the offline copies and the notes that were not sent, because it can occur
  when offline work did not go to the server yet. The app sends them when the account is unlocked
  here again.
- **Preferences** (`manifesto:prefs`) stay after a sign-out. They contain settings, for example the
  theme, and the names of tags hidden from the board. In connected mode, most of them also belong to
  the account, and the server keeps them.
