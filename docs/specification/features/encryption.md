# Encryption

**Status: planned before 1.0.0, design chosen, not yet built.** Today Manifesto does not encrypt notes
itself. This page says what protects notes now and the design chosen:
[end-to-end encryption for every account](#the-design-end-to-end-for-every-account) in connected
mode. Notes are encrypted in the browser before they reach the server, and the server stores them
without a key that opens them.

Where security and convenience pull apart, security wins. [What it costs](#what-it-costs) lists what
is given up for it.

## What is protected today

- **In transit**: connected mode is meant to be served over HTTPS; the client refuses nothing, but every
  deployment guide puts TLS in front of the server (see [Server Deployment](../server/deployment.md)).
- **At rest on the server**: whatever the operator's disk, volume or managed database provides. A
  self-hoster who runs the server on an encrypted volume gets encryption at rest without Manifesto
  knowing.
- **At rest in open mode**: `localStorage` is as private as the browser profile and the device it is on.

The server operator can read every note on their server. For a self-hosted instance that is the user
themselves; for an organisation's deployment it is the organisation. Admins, as distinct from the
operator, cannot read notes from inside the app unless the server allows it; [Privacy](privacy.md) has
the details.

## The design: end to end, for every account

Every account in connected mode is encrypted the same way. It is not a setting, for an account or for
a note: one system, so that there is one kind of note and one way each feature works.

A note is encrypted in the browser and decrypted in the browser. The server stores and passes on
ciphertext. That protects a note from a stolen database or backup, from a disk thrown away, from a
query that reads rows it should not, and from the operator and the admins of someone else's server
reading the database.

What a user notices: entering a secret key when signing in, and a sheet with two keys to keep.
Open mode has no
server and is unchanged; its notes are as private as the browser profile, as today.

### Keys

- **The account key**: 256 random bits, made in the browser when the account is set up. Nobody ever
  sees it, and it never reaches the server except wrapped (encrypted under another key).
- **The secret key and the recovery key**, which the user holds and which each wrap the account
  key: see [Unlocking](#unlocking).
- **A key pair per account** (ECDH on P-256): the public key is on the server for other accounts to
  share with; the private key is stored wrapped by the account key.
- **A note key per note**: 256 random bits, made by the client that creates the note. It is stored
  wrapped by the owner's account key, and once more for each person the note is shared with, wrapped
  to that person's public key.

What is encrypted under which:

- **Under the note key**, what everyone on the note sees: title, text, an excerpt (the first 140
  characters of the text, for [notifications](#reminders)), font, the list of images with their keys,
  link previews, [versions](version-history.md), comments and the collaborative document.
- **Under the account key**, what is one person's own and in their words: a note's tags and colour
  (for a recipient of a shared note too, since those are theirs), and the
  [preferences](preferences.md) that follow the account, which hold the names of hidden tags.

Everything is AES-256-GCM, with the id of the row and the name of the field as associated data, so a
ciphertext cannot be moved to another note or another field. Every primitive is the browser's
own WebCrypto. WebCrypto exists only on `https` pages and on `localhost`, so connected mode over plain
`http` stops working. That was already true of passkeys, push and the service worker.

What the server still reads is what it acts on: ids, who owns a note and who it is shared with in
which role, timestamps, pin, archive and trash state, position, [reminders](#reminders), and the id
and size of each image. It can no longer check a title's length or the number of tags, only the size
of what it is sent; the client keeps those limits.

### Unlocking

An account has three things, each with one job:

| | What it is | What it is for |
|---|---|---|
| **Sign-in** | A password, single sign-on or a passkey, as today | Proves who someone is. It opens no note. |
| **Secret key** | A long random key, kept on the user's devices and on a sheet they save | Decrypts the notes. |
| **Recovery key** | A second such key, kept on the sheet alone | Brings the account back when the sign-in and the secret key are both lost. |

Signing in cannot open the notes, because the server takes part in every sign-in: with single sign-on
there is no password at all, and a local password is seen by the server each time. So decrypting has a
key of its own, the same for every account however it signs in.

**The secret key** is made in the browser when the account is set up: seven groups of four letters and
digits, without the ones that are easy to misread, about 138 bits, behind a prefix that tells it from
the recovery key.

- **What it opens.** The server holds the account key wrapped under a key derived from the secret
  key, and never sees the secret key itself.
- **Why not a passphrase.** Someone holding a copy of the database could guess passphrases against
  the wrapped key for as long as they liked, and the operator of someone else's server is exactly
  that someone. A random key cannot be guessed.
- **On a device.** A device holds the secret key for as long as it is signed in and no longer.
  Signing out removes it, and so does a session the server ended (30 days unused, 90 days at most,
  a password change, an admin ending the account's sessions). A device that is not signed in holds
  nothing that helps open a note.
- **At every sign-in**, then, the secret key is entered again: typed, pasted from wherever the user
  keeps it, or scanned as a QR code from Settings on a device that is signed in, which shows it after
  a confirmation.
- **A new one** can be made in Settings, after a confirmation. It re-wraps the account key, which is
  one small write, and every other device is signed out and asks for the new key.

An account is set up at its first sign-in. The browser makes both keys and shows them once, on one
sheet to save or print, with the server's address and the username, and the user has to confirm they
kept it. Making a new secret key or recovery key is written to the audit log.

While a device is signed in it also holds the account key, in IndexedDB as a key the page can use and
cannot read out, so the service worker can use it. It goes with the secret key when the session ends.

### The recovery key

The recovery key has the same shape as the secret key and its own prefix. It is on the sheet and on
no device.

- **What it does.** With the username it signs in whatever else is lost (the password, the
  authenticator, the passkeys), unlocks the notes, and has a new password chosen on a local account.
  On single sign-on the identity provider still signs in, and the recovery key unlocks. Someone who
  can sign in and has lost only the secret key uses it the same way.
- **Using it replaces every key the account has**: the account key and the key pair under it, the
  secret key and the recovery key, shown as a new sheet. Whoever had the old ones can open nothing
  written afterwards. [Changing keys](#changing-keys) has what that involves. The account's other
  sessions end, and it is written to the audit log.
- **One thing for losing everything.** It takes the place of the ten recovery codes that
  [two-factor sign-in](accounts.md#two-factor-sign-in) has today, which could sign in and open
  nothing.
- **The server never sees it.** The browser derives two values from it: one the server holds a hash
  of, to check the sign-in, and one that wraps the account key.
- **Guessing it** is throttled like a sign-in.
- **A new one** can be made in Settings at any time, after a confirmation, and the old one stops
  working.

**Losing the secret key on every device, and the recovery key, loses the notes.** A temporary password
from an admin, a reset by mail and a sign-in link all restore the sign-in and none of them a key. The
account can then only be emptied and started again. No admin and no operator can help, which is the
point of the design and its largest cost.

A recovery key held by an organisation, so that a managed deployment can recover its own accounts, is
left for later. It would be one more wrapped copy of the account key, and nothing here has to change
for it.

### Sharing

- **Inviting** someone wraps the note key to their public key, in the owner's browser. The
  invitation's preview of the note is decrypted by the recipient with it.
- **Whose key it is.** The server hands out public keys, so a dishonest server could hand out its
  own. Each account's key has a short fingerprint, shown in the People dialog for two people to
  compare, and a client remembers the keys it has seen and says so when one changes.
- **Roles** are enforced by the server, as now: it refuses a viewer's write whatever key they hold.
- **Teams.** The server still turns a team share into one invitation per member. Someone who joins
  the team later gets the invitation at once and the key when the first client of anyone holding the
  note is next online and wraps it for them; until then the invitation says it is waiting. The same
  goes for a team that mirrors a group at the identity provider.
- **Removing someone.** The server stops serving them the note at once, as now. The owner's client
  then makes a new note key, encrypts the title, text and document under it and wraps it for whoever
  is left. Older versions and comments stay under the old key, which the person removed already
  held.
- **[Public links](sharing.md#public-links)** carry a link key in the URL fragment, which no browser
  sends to a server. A live link stores the note key wrapped by the link key; a snapshot stores a copy
  of the note encrypted under it. The password, the expiry and the view limit stay gates the server
  keeps. [Share links](sharing.md), which carry the whole note in the fragment, are unchanged.

### Collaboration

The server stops holding and merging the shared document. It becomes a relay: each edit arrives
encrypted under the note key, is stored as it came and is passed to the others on the note. The
clients do the merging, which Yjs does the same way wherever it runs.

- **Compaction** moves to the clients. When a note has gathered enough edits, a client uploads the
  whole document as one encrypted snapshot and the server drops the edits it covers. The last three
  snapshots are kept, so a faulty one can be passed over.
- **Opening a note cold** reads the newest snapshot and the edits after it.
- **Presence**: cursor states are encrypted too. The server can no longer rewrite the name inside
  one, so it stamps each relayed message with the id, name and colour of the account that sent it,
  and clients show that and ignore any name inside.
- **Unchanged**: who may join (the server checks, as now), the editor schema version check,
  `If-Match` on the note row, and the records that tell a client when a row was
  [written outside the document](collaborative-editing.md#content-written-outside-the-document).

### Images

An image is encrypted in the browser before it is uploaded, and the server stores bytes it cannot
read ([Attachments](attachments.md)).

- **The image's key** is derived from the uploader's account key and the image's bytes, and the
  attachment is found by an HMAC of the bytes under the account key. The same image attached twice by
  one account is still stored once, and the stored value says nothing to someone without the key.
- **The key travels in the note**: the note's image list, encrypted under the note key, holds each
  image's id, key and type, which is how everyone on a shared note opens its images.
- **Ids and sizes stay readable**, so the server can still sweep images no note refers to.
- **The type** is no longer read by the server from the leading bytes; the client records it, and
  the server serves every image as opaque bytes.
- **Thumbnails and icons of link previews** come back from the server with the preview, and the
  client encrypts and stores them like any other image.

### Link previews

The client already asks the server for a page's title, description and image
(`GET /api/link-preview`) and writes the card into the note itself, so nothing about the flow changes.
The card is stored encrypted like the rest of the note. What remains is that the server sees the
address at the moment it fetches it. It stores nothing, so a copy of the database shows no links, but
an operator who logged those requests would see them. A preference turns previews off for an account
that minds.

### Reminders

A reminder's time, timezone and recurrence stay readable to the server, because it is the server that
sends a reminder as a push message when no open app fired it
([Reminders](reminders.md#push-from-the-server)), and that moves a repeating one on. They are
encrypted at rest with [the server's own key](#the-server-key).

What the reminder is about is not readable. The push message carries the note's encrypted title and
excerpt and the wrapped note key, and the service worker opens them with the account key kept on the
device. A device that is signed out has no key and shows "Reminder" with no text. The excerpt is a
value of its own for this reason: every client that saves a note's text saves its first 140 characters
beside it, so the notification is right even after someone else edited the note.

### Tokens that carry a key

A script, an assistant and a calendar app cannot run the client, so they cannot decrypt. For them a
token may carry a key: [API tokens](accounts.md#personal-api-tokens), [MCP](mcp.md) tokens and
[calendar feed](reminders.md#calendar-feed) addresses.

- **Made in the unlocked app.** The client makes the token's secret, derives a wrapping key from it,
  and sends the server the token's hash and the account key wrapped under that key. The server
  cannot open it until the token is used.
- **Used.** A request that presents the token gives the server the secret. For that request the
  server unwraps the account key in memory, decrypts what the request reads, encrypts what it writes,
  and keeps nothing.
- **What works because of it**: the REST API answers a token with readable notes as today,
  `GET /api/search` scans the account's notes in memory, the hosted MCP endpoint keeps all its tools,
  and the calendar feed names each event by its note.
- **Signing an assistant in through the browser** wraps the key on the consent page, which runs in
  the unlocked app, and the secret travels in the code and in the tokens made from it.
- **What it gives away.** While such a request runs, the server can read that account's notes, and
  an operator who recorded a token could read all of them: a scope limits what the server will do
  with a token, not what the key opens. Settings says so when a token is made. An account with no
  token, feed or assistant has no such door, and revoking a token deletes its wrapped key.

The app's own session never sends a key, so the app searches in memory as it does today
([Search](search.md)) and `GET /api/search` answers tokens only.

### Webhooks

A [webhook](webhooks.md) fires on a change made in the app, when no key is on the server. It carries
the event, the note's id and the fields the server reads, and no title, text or tags. A receiver that
needs them reads the note with an API token. The webhook's secret, which the server has to read back
to sign a delivery, is encrypted with the server's key.

### The server key

A few values the server has to read by itself: reminders, webhook secrets and the secrets of
authenticator apps. They are AES-256-GCM under one **server key** that is never in the database. The
operator supplies it (`DATA_ENCRYPTION_KEY`), or the server makes one on first start and writes it to
a key file of its own, and says at start-up where it is and that it must be backed up apart from the
database.

Replacing it: the server takes the new key and, beside it, the one before
(`DATA_ENCRYPTION_KEY_PREVIOUS`). Each value carries the id of the key it is under, and a job at
start-up moves the old ones over and says in the log when the previous key can be removed. Losing the
server key loses reminder times, webhooks and authenticator set-ups, which can be made again. It loses
no note.

### What it does not protect

- **A server that serves a changed client.** The server most people load the app from is the one
  that stores their notes, and a client changed to send the key away would look the same. The client
  is a static build that can be hosted apart from the server it talks to
  ([Client Deployment](../client/deployment.md)), by someone the user trusts or by the user, once the
  operator allows that address in `CORS_ORIGINS`. For someone who loads the app from the operator,
  the design protects against everything that reads the database and not against an operator who
  changes the code.
- **A swapped public key** when sharing, unless the fingerprints are compared.
- **Requests made with a token**, as [above](#tokens-that-carry-a-key).
- **What the server reads**: which notes and images exist, whose they are and who they are shared
  with, how large, when they changed, their pin, archive and trash state, which have a reminder, and,
  to the running server, when it is due. A note's id is a ULID, which carries the moment it was
  created. The address of a link at the moment its preview is fetched.
- **The device.** A signed-in browser profile holds the secret key, the account key and the notes
  in memory.

### Changing keys

- **The secret key** or **the recovery key** alone: a new one made in Settings re-wraps the account
  key, as above. That is for a key that was mislaid while the other is still in hand.
- **Every key at once**, which is what using the recovery key does, and what a command in Settings
  does for a key or a device that someone else may have:
  - The browser makes a new account key and key pair, and a new secret key and recovery key.
  - It re-encrypts the account's tags, colours and preferences, and re-wraps the keys of its notes.
  - It then gives each note the account owns a new note key, as when
    [someone is removed](#sharing), so that the old keys open nothing written from then on. Images
    already attached keep their keys.
  - Every other device is signed out, and every token, feed address and assistant is revoked.
  - Notes shared with the account are re-wrapped to its new public key by their owners' clients,
    with the same wait as joining a team.
  - The work runs a batch at a time and goes on after an interruption; the old account key is kept,
    wrapped under the new one, until nothing is left under it.
- **A note key**: when someone is removed, as under [Sharing](#sharing).
- **The server key**: as [above](#the-server-key).

### Moving an existing server over

After the upgrade, an account is moved by its own browser at its next sign-in: it sets up the keys,
then encrypts the account's notes, versions and images a batch at a time and replaces the readable
rows. A row with no key version is one not yet encrypted, so both kinds are read while the work runs
and after an interruption.

- A shared note is encrypted by its owner's client; the people on it read it as before until then,
  and get their wrapped key with it.
- A collaborative document is loaded by that client and stored again as a first snapshot.
- Tokens, feed addresses and public links made before the move carry no key. They are revoked when
  the account is moved, and Settings lists what has to be made again.
- An account that never signs in stays readable. The admin overview counts the accounts not yet
  moved.

### Order of building

1. Keys and unlocking: the account key, the key pair, the secret key, the recovery key (in place of
   the two-factor recovery codes), the sheet, the keys
   kept on a device, and set-up at sign-in.
2. Notes: title, text, excerpt, font, tags, colour, versions and preferences, with the move of
   existing rows.
3. Images.
4. Sharing: wrapping to public keys, fingerprints, the wait for a key, a new note key on removal,
   comments and public links.
5. Collaboration as a relay, with snapshots.
6. Tokens that carry a key (API, MCP, the calendar feed), and webhooks without content.
7. The server key, and push messages with an encrypted title and excerpt.
8. Replacing the account key.

Steps 2 to 7 are released together: a server half way would hold notes its own features cannot read.

## What it costs

- **Notes can be lost for good**: with the secret key and the recovery key both gone, no admin can
  bring them back.
- **One more step**: the secret key entered at every sign-in, which is at least every 90 days on
  each device, and a sheet to keep.
- **HTTPS is required** for connected mode.
- **The admin export goes** (`ADMIN_EXPORT`): the server has nothing readable to hand over. A user
  exports their own notes from the app, as now.
- **Webhooks carry no content**, and the recipes that used it read the note with a token.
- **Joining a team** can mean waiting for a key.
- **The server checks less**: it cannot validate what is inside a note, or search it for the app.

## Why not a choice

Encryption for some accounts, or for single locked notes, was considered and decided against
([Non-goals](../non-goals.md)). Either makes two kinds of note, and every feature above would have to
be built and kept working twice: once where the server reads the note and once where it does not.

An earlier form of this design had the server encrypt everything with a key of its own. It kept every
feature as it is and asked nothing of the user, and it left the operator of someone else's server able
to read every note. What is left of it is [the server key](#the-server-key).
