# Encryption

**Status: planned before 1.0.0, design chosen, being built.** Steps 1 to 3 and 5 of
[the order of building](#order-of-building) are in place, and part of step 4: every account has its
keys and is unlocked with its secret key, and a note's title, text, tags, colour, images and shared
document are sealed in the browser. The rest
is not, and [what is built so far](#what-is-built-so-far) lists what still reaches the server
readable. This page says what protects notes now and the design chosen:
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
  sees it, and it never reaches the server except wrapped (encrypted under another key). It encrypts
  nothing itself. A key for each job is derived from it: the **notes key**, which wraps note keys;
  the **personal key**, for what is one person's own; the **reminder key**, for
  [reminders](#reminders); and one each for the private keys and for images. Where this page says
  "under the account key", it is under the one of these that fits. A
  [token](#tokens-that-carry-a-key) is given the ones it needs and never the account key.
- **The secret key and the recovery key**, which the user holds and which each wrap the account
  key: see [Unlocking](#unlocking).
- **Two key pairs per account** (P-256): one that note keys are wrapped to (ECDH) and one that
  signs (ECDSA). The public keys are on the server for other accounts to share with; the private
  keys are stored wrapped under the account key.
- **A note key per note**: 256 random bits, made by the client that creates the note. It is stored
  wrapped by the owner's notes key. For each person the note is shared with it is wrapped to that
  person's public key, and wrapped again by their own notes key when they accept.

What is encrypted under which:

- **Under the note key**, what everyone on the note sees: title, text, an excerpt (the first 140
  characters of the text, for [notifications](#reminders)), font, the list of images with their keys,
  link previews, [versions](version-history.md), comments and the collaborative document.
- **Under the account key**, what is one person's own and in their words: a note's tags and colour
  (for a recipient of a shared note too, since those are theirs), and the
  [preferences](preferences.md) that follow the account, which hold the names of hidden tags.

Everything is AES-256-GCM, each value with a random 96-bit nonce of its own. The associated data is
the id of the row, the name of the field, the version of the key and, for a personal field, the
account, so a ciphertext cannot be moved to another note, another field or another person, or passed
off under a key that has been replaced.

- **Edits and cursor states**, which are many, are each under a key derived from the note key for
  that purpose. Random nonces are safe for about 2^32 messages under one key, which is far past what
  a note sees once these are apart from the rest.
- **Values with few possibilities** (colour, font) are padded to one length, since the length of a
  ciphertext would otherwise name them.
- **The server refuses** anything in an encrypted field that is not shaped as a ciphertext, so a
  faulty client cannot store readable text there.

Every primitive is the browser's own WebCrypto. WebCrypto exists only on `https` pages and on `localhost`, so connected mode over plain
`http` stops working. That was already true of passkeys, push and the service worker.

What the server still reads is what it acts on: ids, who owns a note and who it is shared with in
which role, timestamps, pin, archive and trash state, position, [reminders](#reminders), and the id
and size of each image. It can no longer check a title's length or the number of tags, only the size
of what it is sent; the client keeps those limits.

The client also takes over checking what comes in. What it decrypts was written by someone else's
client and checked by no server, so it is read the way an imported file is: every field goes through
the checks the server makes today before anything is drawn, and a value that fails is left out. That
includes the preview of an invitation, which is shown before the note is accepted.

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
- **A device that is off** cannot hear that its session ended. It keeps the day its session runs out
  at the latest and removes the keys itself when it is started after that day. Until then a device
  that was taken holds them, which is [the device](#what-it-does-not-protect).
- **Offline copies.** The copy of a note kept for editing offline
  ([Privacy](privacy.md#on-the-device)) is encrypted under a key derived from the account key. Today
  a session the server ended leaves those copies readable, so that edits made offline are not lost;
  encrypted, they are kept and cannot be read until the account is unlocked there again.
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
- **Using it replaces every key the account has**: the account key and the key pairs under it, the
  secret key and the recovery key, shown as a new sheet. Whoever had the old ones can open nothing
  written afterwards. [Changing keys](#changing-keys) has what that involves. The account's other
  sessions end, and it is written to the audit log.
- **One thing for losing everything.** It takes the place of the ten recovery codes that
  [two-factor sign-in](accounts.md#two-factor-sign-in) had, which could sign in and open
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

An account started again has new key pairs that nothing vouches for. Notes shared with it do not
come back by themselves: each owner is told the key changed and decides whether to share again
([Sharing](#sharing)). Otherwise an admin could issue a temporary password, start the account again
and be handed every note shared with it.

A recovery key held by an organisation, so that a managed deployment can recover its own accounts, is
left for later. It would be one more wrapped copy of the account key, and nothing here has to change
for it.

### Sharing

- **Inviting** someone wraps the note key to their public key, in the owner's browser. The
  invitation's preview of the note is decrypted by the recipient with it. Accepting wraps the key
  again under the recipient's notes key, like the key of a note of their own, so the private key is
  needed only to open an invitation.
- **Whose key it is.** The server hands out public keys, so a dishonest server could hand out its
  own. Each account's keys have a short fingerprint, shown in the People dialog for two people to
  compare. An account remembers the keys it has seen, in a list kept on the server under its account
  key, since a device keeps nothing past its session.
- **A key that changes.** New keys are signed with the ones they replace, which using the recovery
  key and the command in Settings can both do, and a client takes such keys without asking. Keys
  that are not signed so (an account started again, or a server handing out its own) are wrapped to
  by nobody until the owner of the note agrees in the People dialog, which says that the person's
  key changed.
- **Who wrapped it.** Wrapping to a public key takes no secret, and the server knows every public
  key, so by itself a wrapped key says nothing about who made it. A server could put a key of its
  own in place of the one a recipient was sent, and read what they then wrote under it. So the
  client that wraps a note key signs it, together with the note's id, the version of the key and
  the account it is for. The recipient's client checks that signature against the key it remembers
  for the signer, and uses no wrapped key that fails: the note says its key could not be checked.
  This covers the key that arrives with an invitation and each new one after
  [someone is removed](#sharing). Once accepted, the copy under the recipient's own notes key cannot
  be swapped at all.
- **Roles** are enforced by the server, as now: it refuses a viewer's write whatever key they hold.
- **Teams.** The server still turns a team share into one invitation per member. Someone who joins
  the team later gets the invitation at once and the key when the first client of anyone holding the
  note is next online and wraps it for them; until then the invitation says it is waiting. The same
  goes for a team that mirrors a group at the identity provider. That client signs the key as an
  owner does, and the invitation names it, so the member's client checks it against someone it is
  told is on the note.
- **Removing someone.** The server stops serving them the note at once, as now. The owner's client
  then makes a new note key, encrypts the title, text and document under it and wraps it for whoever
  is left. Older versions and comments stay under the old key, which the person removed already
  held; it is kept wrapped under the new one, so that everyone on the note can still read them.
- **The same happens** whenever someone who held the key stops holding the note: they leave it or
  leave the team it came through, they decline an invitation or it is withdrawn (its preview had
  already given them the key), or a live public link is revoked or runs out.
- **[Public links](sharing.md#public-links)** carry a link key in the URL fragment, which no browser
  sends to a server. A live link stores the note key wrapped by the link key; a snapshot stores a copy
  of the note encrypted under it. The link key is not the token the server finds the link by, and
  the server never holds it: the owner's copy, for copying the link again, is kept under the account
  key. The password, the expiry and the view limit stay gates the server
  keeps. [Share links](sharing.md), which carry the whole note in the fragment, are unchanged.

### Collaboration

The server stops holding and merging the shared document. It becomes a relay: each edit arrives
encrypted under the note key, is stored as it came and is passed to the others on the note. The
clients do the merging, which Yjs does the same way wherever it runs.

- **Compaction** moves to the clients. When a note has gathered enough edits, a client uploads the
  whole document as one encrypted snapshot. The server keeps the edits a snapshot covers until the
  snapshot after it has arrived, and keeps the last three snapshots, so a faulty one can be passed
  over without losing the edits it claimed to hold.
- **Opening a note cold** reads the newest snapshot and the edits after it.
- **Presence**: cursor states are encrypted too. The server can no longer rewrite the name inside
  one, or see whose cursor a message moves, so it stamps each relayed message with the connection it
  came from and the id, name and colour of that account. Clients show that, ignore any name inside,
  and take a cursor only from the connection that first published it.
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
  the server serves every image as opaque bytes. The type in a note was written by whoever attached
  the image, so a client reading it does what the server did: it takes only the five image types,
  checks the leading bytes after decrypting, and shows nothing that fails.
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

A note with a reminder also has its key wrapped under the account's reminder key, by the client that
sets the reminder. That copy goes when the reminder does. It is what a
[calendar feed](#tokens-that-carry-a-key) opens, so a feed reaches the notes that have a reminder
and no others.

### Tokens that carry a key

A script, an assistant and a calendar app cannot run the client, so they cannot decrypt. For them a
token may carry a key: [API tokens](accounts.md#personal-api-tokens), [MCP](mcp.md) tokens and
[calendar feed](reminders.md#calendar-feed) addresses.

- **Made in the unlocked app.** The client makes the token's secret, derives a wrapping key from it,
  and sends the server the token's hash and the keys the token needs wrapped under that key. The
  server cannot open them until the token is used. The wrapping key is derived apart from the hash
  the server stores, which is a plain SHA-256 of the token and must not be the key as well.
- **Which keys.** An API or MCP token carries the notes key and the personal key. A calendar feed
  carries the reminder key alone. No token carries the account key, so none opens the private keys,
  accepts an invitation or wraps anything for another token.
- **Used.** A request that presents the token gives the server the secret. For that request the
  server unwraps the token's keys in memory, decrypts what the request reads, encrypts what it
  writes, and keeps nothing.
- **What works because of it**: the REST API answers a token with readable notes as today,
  `GET /api/search` scans the account's notes in memory, the hosted MCP endpoint keeps all its tools,
  and the calendar feed names each event by its note.
- **Signing an assistant in through the browser** wraps the key on the consent page, which runs in
  the unlocked app, and the secret travels in the code and in the tokens made from it. At each
  exchange the server wraps the keys again for the new access and refresh tokens and deletes the
  copies before them, so the secret in a code is good once and for two minutes.
- **What it gives away.** While such a request runs, the server can read that account's notes, and
  an operator who recorded a token could read all of them: a scope limits what the server will do
  with a token, not what the key opens. Settings says so when a token is made. An account with no
  token, feed or assistant has no such door, and revoking a token deletes its wrapped keys.
- **What revoking cannot take back.** Someone who had a token and a copy of the database from while
  it worked has that token's keys for good, and the notes key opens what is written later too. When a
  token is revoked because it leaked, Settings offers to [replace every key](#changing-keys).
- **A feed address is the weakest of these.** It is a secret in a URL: the calendar service that
  fetches it has it, and so has every proxy on the way. That is why it carries the reminder key and
  nothing else. The server's own request log, which records paths, leaves the secret out of this
  one.

The app's own session never sends a key, so the app searches in memory as it does today
([Search](search.md)) and `GET /api/search` answers tokens only.

### Webhooks

A [webhook](webhooks.md) fires on a change made in the app, when no key is on the server. It carries
the event, the note's id and the fields the server reads, and no title, text or tags. A receiver that
needs them reads the note with an API token. The webhook's secret, which the server has to read back
to sign a delivery, is encrypted with the server's key.

### The server key

A few values the server has to read by itself: reminders, webhook secrets, the secrets of
authenticator apps, the key that signs push messages and the keys of each push subscription. They
are AES-256-GCM under one **server key** that is never in the database. The
operator supplies it (`DATA_ENCRYPTION_KEY`), or the server makes one on first start and writes it to
a key file of its own, and says at start-up where it is and that it must be backed up apart from the
database. It warns when the key file is in the same directory as the database or its backups, where
a copy of one would carry the other.

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
- **A swapped public key** the first time two people share, unless the fingerprints are compared.
  After that a swap is a key that changed without being signed, which a client refuses until the
  owner agrees. The same first time is the limit of checking who wrapped a note key: a signature
  from someone never met before is checked against whatever key the server gives for them.
- **Who is in a team.** The server says who is in a team (an admin does, or the identity provider),
  and clients wrap a team note's key for whoever it names. An admin who adds an account to a team
  gets the notes shared with that team, as today. The note's People list shows every member who
  holds it.
- **Requests made with a token**, as [above](#tokens-that-carry-a-key).
- **What the server reads**: which notes and images exist, whose they are and who they are shared
  with, how large, when they changed, their pin, archive and trash state, which have a reminder, and,
  to the running server, when it is due. A note's id is a ULID, which carries the moment it was
  created. The address of a link at the moment its preview is fetched. Usernames, names and email
  addresses, teams and who is in them, and the audit log. How many versions and comments a note has,
  who wrote each and when, and the moments at which a note is being edited.
- **A page that is not the server's.** The secret key is typed at sign-in, so a false sign-in page
  can collect it along with the password. A passkey resists that for the sign-in, not for the
  secret key.
- **The device.** A signed-in browser profile holds the secret key, the account key and the notes
  in memory, and a device that is taken while switched off holds the keys until its session would
  have run out.

### Changing keys

- **The secret key** or **the recovery key** alone: a new one made in Settings re-wraps the account
  key, as above. That is for a key that was mislaid while the other is still in hand.
- **Every key at once**, which is what using the recovery key does, and what a command in Settings
  does for a key or a device that someone else may have:
  - The browser makes a new account key and key pairs, and a new secret key and recovery key, and
    signs the new public keys with the old ones.
  - It re-encrypts the account's tags, colours and preferences, and re-wraps the keys of its notes.
  - It then gives each note the account owns a new note key, as when
    [someone is removed](#sharing), so that the old keys open nothing written from then on. Images
    already attached keep their keys.
  - Every other device is signed out, and every token, feed address and assistant is revoked.
  - Notes shared with the account keep their note keys, which are their owners' to change, and are
    re-wrapped with its own. An invitation not yet accepted is wrapped again to the new public key
    by its owner's client, with the same wait as joining a team.
  - The work runs a batch at a time and goes on after an interruption; the old account key is kept,
    wrapped under the new one, until nothing is left under it.
- **A note key**: when someone is removed, as under [Sharing](#sharing).
- **The server key**: as [above](#the-server-key).

### A server from before encryption

Notes written before encryption are not encrypted where they lie. A server from before it is not
upgraded in place: the encrypted version starts on an empty database, and each person carries their
own notes across.

- **Before the upgrade**, each user exports their notes from Settings
  ([Export and Import](export-import.md)). The zip holds their notes with the images, the archive
  and the trash, and the version history.
- **After it**, they sign in to an account on the new database, which is encrypted from its first
  sign-in, and import the zip. The browser encrypts each note as it stores it, like any note written
  there.
- **What does not come across**: notes someone else shared, which their owner imports and shares
  again; comments; and tokens, feed addresses, webhooks and public links, which are made again.
  Accounts are made again too.
- **The old database** and its backups are the readable copy. The operator keeps them until everyone
  has their notes, then deletes them.
- **A server started on a database from before** refuses to start and says why, so that readable
  notes never sit beside encrypted ones.

Changing rows in place was decided against. The old text would stay in the database's free pages and
in every backup made before, and the client would have to accept readable rows beside encrypted ones
for as long as any account had not signed in.

### Order of building

1. Keys and unlocking: the account key, the key pairs, the secret key, the recovery key (in place of
   the two-factor recovery codes), the sheet, the keys
   kept on a device, and set-up at sign-in.
2. Notes: title, text, excerpt, font, tags, colour, versions and preferences.
3. Images.
4. Sharing: wrapping to public keys, fingerprints, the wait for a key, a new note key on removal,
   comments and public links.
5. Collaboration as a relay, with snapshots.
6. Tokens that carry a key (API, MCP, the calendar feed), and webhooks without content.
7. The server key, and push messages with an encrypted title and excerpt.
8. Replacing the account key.

Steps 2 to 7 are released together: a server half way would hold notes its own features cannot read.

### What is built so far

Steps 1 to 3 and 5 are built, and part of step 4. Until the rest is, this page describes more than
the code does, and nothing here may be released:

- **Sealed in the browser**: a note's title, text, excerpt, font, link previews and list of images
  under its note key, its tags and colour under the reader's personal key, its versions, and the
  account's preferences. The server refuses anything else in their place, refuses to start on a
  database that holds notes from before, and has no search, export or admin export of notes.
- **Images** are sealed before upload, each under a key made from the account key and the image's
  bytes and found by an HMAC of them, with the key and type carried in the note. The server stores
  and serves bytes of no stated kind, and the client checks what it opens.
- **The shared document** a note is edited in is sealed: the readable document stays in the
  browser, and what the server syncs and stores is a list of sealed edits and snapshots, with
  cursors sealed beside it. This is narrower than [Collaboration](#collaboration) describes in one
  way: the server still runs Yjs for the room, merging the list of sealed entries, so the rules
  about which edits and snapshots are kept are followed by the clients that compact a note and not
  enforced by the server.
- **Nothing a person writes reaches the server readable any more**, outside a request made with a
  token that carries a key.
- **Sharing a note** hands its key on: wrapped to the recipient's public key and signed by whoever
  wrapped it, opened and checked by their client, and kept under their own notes key when they
  accept. A member of a team waits until the first client of anyone holding the note wraps it for
  them. An invitation's mail no longer names the note.
- **A note gets a new key** when someone who held the old one stops holding the note, or a live
  public link is revoked: the server marks the note, and the first device of its owner to see that
  seals the title, text, images and previews again under a new key, keeps the old keys sealed under
  it for the versions, comments and edits they wrote, and hands the new one to the links that stay
  and, as they come online, to the people still on the note. Narrower than
  [Sharing](#sharing) describes in two ways: the shared document is not sealed again, so what was
  typed before stays in the log under the old key until the clients compact it away, and a live
  link that runs out, as opposed to one revoked, does not mark the note.
- **Whose key it is.** An account remembers the public keys it has seen of the people it shares
  with, in a list the server keeps sealed under the account's own key. The first key seen for
  someone is taken; a different one later is wrapped to by nobody and checks no signature until
  the person agrees to it in the People dialog, which says the key changed and shows its
  fingerprint. The same dialog shows everyone's fingerprint to compare. Two limits: a new key is
  never taken without asking, since keys are not yet signed with the ones they replace (that comes
  with [replacing the account key](#order-of-building)), and a server that drops an entry from the
  list is met as a first sight of that person, which only comparing fingerprints catches.
- **Public links** carry a link key in the fragment of their address. A live link stores the note
  key wrapped by it; a snapshot stores a copy of the note sealed under a key derived from it. The
  owner's copy of the link key is sealed under their personal key. The page opens the note, and its
  pictures, in the browser.
- **Comments** are sealed under the note key, each bound to an id its writer chose.
- **An API or MCP token made in Settings** carries the notes key and the personal key, wrapped
  under a key derived from its secret, which the app makes and the server never sees until the
  token is used. For a request that presents it the server opens and seals notes in memory: notes,
  versions, comments, sync, import and `GET /api/search` work as before, and so do the MCP tools.
  Webhooks carry no content.
- **A calendar feed's address** is made in the app like any token that carries a key, and carries
  the reminder key alone. A note with a reminder has its key wrapped under its reader's reminder
  key, by the client that sets the reminder; the copy goes when the reminder does and when the
  note's key is replaced. A reminder set by a script, which holds no reminder key, has no copy
  until a device of the account next sees the note and leaves one; until then the feed names that
  event "Reminder".
- **An assistant signed in through the browser** carries the same two keys. The consent page makes
  the code and wraps the keys under it; the server is sent the code's hash and first sees the code
  when the assistant trades it in. At that exchange, and at every refresh, the server wraps the
  keys again for the new access and refresh tokens and writes over the copies before them.
- **Not built of tokens yet** (the rest of step 6): a token cannot attach or read images; Settings
  does not offer to replace every key when a token is revoked, since that is step 8.
- **A push message** for a reminder carries the note's sealed title and excerpt and the reader's
  wrapped copy of the note key, beside words that say only that there is a reminder. The service
  worker opens them with the account key the device keeps while signed in, and shows the title
  and the first of the text; a device without the key shows the bare words. A message too large
  for a push service loses the excerpt first and then the title.
- **Not built of the server key yet** (the rest of step 7): reminder times, webhook secrets,
  authenticator secrets, the key that signs push messages and the keys of push subscriptions are
  stored as they were, not under a key of the server's.
- **Using the recovery key** replaces the secret key and the recovery key, and keeps the account key
  and the key pairs. Replacing those is step 8, which has to re-encrypt what is under them.

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
