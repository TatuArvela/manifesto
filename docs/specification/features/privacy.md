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
| **Connected, someone else's server** | The operator, through the database or its backups. Admins, only with `ADMIN_EXPORT` on (below). The people a note is [shared with](sharing-with-people.md). |

Notes are not end-to-end encrypted; [Encryption](encryption.md) says why and what would change that.
Anyone who needs notes the server cannot read should use open mode, or run their own server.

## What an admin can see

An [admin](accounts.md) administers accounts, not their contents. From inside the app an admin sees:

- **Every account**: username, display name, email address, whether it is an admin, how it signs in,
  its note count, when it was created and last seen.
- **The overview**: totals, and per account the number of notes, shares, images, the bytes they take
  and saved versions. Counts, never contents.
- **The audit log**: who did what to which account or note, when, and from which address. It records
  that a note was shared, never what the note says.

An admin does not see the notes themselves: no view, route or search in the app reads another
account's notes. Two actions come close, and both are visible to the account's owner:

- **Downloading an account's notes** (`GET /api/admin/users/:id/export`), for a data request or a
  move to another server. It is off unless the server sets `ADMIN_EXPORT=on`
  ([Server Deployment](../server/deployment.md)), and it answers `403` with
  `code: "admin_export_disabled"` otherwise. When it is on, each download is recorded as
  `admin.user_exported`.
- **Issuing a temporary password** (local sign-in only). An admin who used it to sign in as someone
  would first have to choose a new password, which signs the owner out everywhere, turns off their
  two-factor sign-in, and leaves their own password not working. It is recorded as
  `admin.password_reset`.

## What a user can see about their account

Settings has an **Activity** page for every signed-in user (`GET /api/auth/me/activity`): the audit
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
- **The audit log**, with client addresses.
- **Backups**, when `BACKUP_INTERVAL_HOURS` is set: whole copies of all of the above, in `BACKUP_DIR`.

The server's own log carries method, path, status and timing, never a request body or a query string,
so what someone searches for is not logged. Encryption at rest is whatever the operator's disk or
database provides.

## What reaches third parties

- **Link previews** (connected mode, `LINK_PREVIEWS` on by default): the server fetches the pages a
  note links to. Those sites see the server's address, not the user's, and the URL, not the note.
  Open mode never does this; its CSP forbids it.
- **Webhooks**: a user's own [webhooks](webhooks.md) post note events to the URLs they chose.
- **Mail**, with `SMTP_URL` set: password reset links and share invitations go through that relay.
- **The update check** (`UPDATE_CHECK`): the server asks GitHub for the newest release. It sends
  nothing about users or notes.
- **Share links** ([Sharing](sharing.md)) carry the note in the URL fragment, which the browser does
  not send to any server; whoever holds the link can read the note.

## On the device

- **Open mode** keeps everything in `localStorage` and IndexedDB, as private as the browser profile.
- **Connected mode** keeps the notes in memory, and an offline copy of each note opened for editing in
  IndexedDB (`manifesto:yjs:<id>`), so an edit made offline survives a reload.
- **Signing out** does not delete those copies yet, so on a shared computer, signing out is not the
  same as leaving no trace; clearing the site's data is.
