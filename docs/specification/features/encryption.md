# Encryption

**Status: released in 0.6.0, one step left before 1.0.0.** Steps 1 to 7 of
[the order of building](#order-of-building) are complete. Each account has its keys, and its secret
key unlocks it. The browser seals all that a person writes in a note (its title, text, tags, color,
images, shared document, versions and comments). Step 8, the replacement of the account key, is not
complete. [What is built so far](#what-is-built-so-far) tells where the build is narrower than the
design.

This page tells what protects notes, and how:
[end-to-end encryption for every account](#the-design-end-to-end-for-every-account) in connected
mode. The browser encrypts notes before they go to the server. The server stores them without a key
that opens them.

Where security and convenience do not agree, security wins. [What it costs](#what-it-costs) lists
what we give up for it.

## What protects notes

- **In connected mode**: the browser seals the notes, as the rest of this page describes. The server
  stores them, and its database and backups contain them, without a key that opens them. [What it
  does not protect](#what-it-does-not-protect) lists what the server can still read.
- **In transit**: connected mode must use HTTPS. The client refuses nothing, but each deployment
  guide puts TLS in front of the server (see [Server Deployment](../server/deployment.md)). The seal
  does not replace TLS. TLS also protects the session, the secret key typed at sign-in, and what the
  server reads.
- **At rest in open mode**: `localStorage` is only as private as the browser profile and its device.

[Privacy](privacy.md) tells who can read what, and what admins see.

## The design: end to end, for every account

All accounts in connected mode have the same encryption. It is not a setting, for an account or for a
note. It is one system. Thus, there is one type of note, and each feature works in one way.

The browser encrypts a note and decrypts it. The server stores and sends ciphertext. This protects a
note from:

- A stolen database or backup.
- A discarded disk.
- A query that reads rows that it must not read.
- The operator and the admins of the server of a different person, if they read the database.

What a user sees: a secret key to enter at sign-in, and a sheet with two keys to keep. Open mode has
no server and does not change. Its notes are as private as the browser profile, as before.

### Keys

- **The account key**: 256 random bits, made in the browser when the account is set up. Nobody ever
  sees it. It never goes to the server unless it is wrapped (encrypted under a different key). It
  encrypts nothing itself. A key for each job comes from it:
  - The **notes key**, which wraps note keys.
  - The **personal key**, for data that belongs to one person.
  - The **reminder key**, for [reminders](#reminders).
  - One key for the private keys, and one key for images.

  When this page says "under the account key", it means under the correct one of these. A
  [token](#tokens-that-carry-a-key) gets the keys that it needs, and never the account key.
- **The secret key and the recovery key**, which the user keeps. Each one wraps the account key. See
  [Unlocking](#unlocking).
- **Two key pairs for each account** (P-256): one to which note keys are wrapped (ECDH), and one that
  signs (ECDSA). The public keys are on the server, so that other accounts can share with the account.
  The private keys are stored wrapped under the account key.
- **A note key for each note**: 256 random bits, made by the client that creates the note. It is
  stored wrapped by the notes key of the owner. For each person who shares the note, it is wrapped to
  the public key of that person. When they accept, it is wrapped again by their own notes key.

What is encrypted under which key:

- **Under the note key**, what all persons on the note see: title, text, an excerpt (the first 140
  characters of the text, for [notifications](#reminders)), font, the list of images with their keys,
  link previews, [versions](version-history.md), comments and the collaborative document.
- **Under the account key**, what belongs to one person and is in their words: the tags and the color
  of a note (also for a recipient of a shared note, because those values belong to them), and the
  [preferences](preferences.md) that go with the account, which contain the names of hidden tags.

All encryption is AES-256-GCM. Each value has its own random 96-bit nonce. The associated data is the
id of the row, the name of the field, the version of the key and, for a personal field, the account.
Thus, nobody can move a ciphertext to a different note, field or person, or use it under a key that
was replaced.

- **Edits and cursor states** are many. Each is under a key derived from the note key for that
  purpose. Random nonces are safe for approximately 2^32 messages under one key. When these values
  are separate from the others, that is much more than a note sees.
- **Values with few possibilities** (color, font) have padding to one length, because the length of a
  ciphertext can tell them.
- **The server refuses** a value in an encrypted field that does not have the shape of a ciphertext.
  Thus, a faulty client cannot store readable text there.

Each primitive is the own WebCrypto of the browser. WebCrypto exists only on `https` pages and on
`localhost`. Thus, connected mode over plain `http` stops. That was already true of passkeys, push
and the service worker.

The server still reads what it acts on: ids, the owner of a note and the persons who share it in each
role, timestamps, pin, archive and trash state, position, [reminders](#reminders), and the id and
size of each image. It cannot check the length of a title or the number of tags now. It can only
check the size of what it gets. The client keeps those limits.

The client also checks what comes in. What it decrypts came from the client of a different person,
and no server checked it. Thus, the client reads it as it reads an imported file. Each field goes
through the checks that the server made before, before the client draws anything. The client removes
a value that fails. This includes the preview of an invitation, which shows before the note is
accepted.

### Unlocking

An account has three things. Each has one job:

| | What it is | What it is for |
|---|---|---|
| **Sign-in** | A password, single sign-on or a passkey, as before | Proves who a person is. It opens no note. |
| **Secret key** | A long random key, kept on the devices of the user and on a sheet that they save | Decrypts the notes. |
| **Recovery key** | A second such key, kept only on the sheet | Brings the account back when the sign-in and the secret key are both lost. |

The sign-in cannot open the notes, because the server takes part in each sign-in. With single
sign-on, there is no password. The server sees a local password each time. Thus, the decryption has
its own key, the same for all accounts, whatever their sign-in.

**The secret key** is made in the browser when the account is set up. It has seven groups of four
letters and digits, without the characters that are easy to read incorrectly, approximately 138 bits.
A prefix tells it from the recovery key.

- **What it opens.** The server keeps the account key wrapped under a key derived from the secret key.
  It never sees the secret key itself.
- **Why not a passphrase.** A person with a copy of the database can guess passphrases against the
  wrapped key for as long as they want. The operator of the server of a different person is exactly
  such a person. Nobody can guess a random key.
- **On a device.** A device keeps the secret key for as long as it is signed in, and no longer. A
  sign-out removes it. A session that the server ended also removes it (30 days without use, 90 days
  maximum, a password change, an admin who ends the sessions of the account). A device that is not
  signed in keeps nothing that helps to open a note.
- **A device that is off** cannot learn that its session ended. It keeps the last possible day of its
  session. When it starts after that day, it removes the keys itself. Until then, a stolen device
  keeps them. See [the device](#what-it-does-not-protect).
- **Offline copies.** The copy of a note kept for offline editing ([Privacy](privacy.md#on-the-device))
  is encrypted under a key derived from the account key.
  - A session that the server ended keeps those copies, so that offline edits are not lost. They are
    encrypted, so nobody can read them until the account is unlocked there again.
  - The same applies to the draft of the new-note composer and to new notes that wait to be sent.
    Each is sealed under its own key derived from the account key, bound to the account, its key
    version and the record. It opens only when the account is unlocked there again.
  - A sign-out deletes them.
- **At each sign-in**, the user enters the secret key again. The user types it, pastes it from where
  they keep it, or scans it as a QR code from Settings on a signed-in device. Settings shows it after
  a confirmation. A new device that [signs in from a signed-in device](accounts.md#signing-in-a-new-device)
  gets it from the approval, wrapped to a key pair that the new device made for the request. The
  server carries the wrap and cannot open it.
- **A new one**: you can make one in Settings, after a confirmation. It wraps the account key again,
  which is one small write. All other devices are signed out, and ask for the new key.

The account is set up at its first sign-in. The browser makes both keys and shows them one time, on
one sheet to save or print, with the address of the server and the username. The user must confirm
that they kept it. A new secret key or recovery key shows in the same way before anything is
replaced. The old key continues to work until the user confirms that they kept the new key. The audit
log records each new key.

While a device is signed in, it also keeps the account key in IndexedDB, as a key that the page can
use but cannot read out. Thus, the service worker can use it. It goes with the secret key when the
session ends.

### The recovery key

The recovery key has the same shape as the secret key, and its own prefix. It is on the sheet, and on
no device.

- **What it does.** With the username, it signs in whatever else is lost (the password, the
  authenticator, the passkeys). It unlocks the notes. On a local account, the user selects a new
  password. With single sign-on, the identity provider still signs in, and the recovery key unlocks.
  A person who can sign in and lost only the secret key uses it in the same way.
- **Its use replaces all keys of the account**: the account key and the key pairs under it, the
  secret key and the recovery key. The new keys show on a new sheet. A person who had the old keys can
  open nothing that is written after this. [Changing keys](#changing-keys) tells what that includes.
  The other sessions of the account end, and the audit log records it.
- **One thing for the loss of everything.** It replaces the ten recovery codes that
  [two-factor sign-in](accounts.md#two-factor-sign-in) had. Those codes could sign in, but could
  open nothing.
- **The server never sees it.** The browser derives two values from it. The server keeps a hash of
  the first, to check the sign-in. The second wraps the account key.
- **Guesses** have the same throttle as a sign-in.
- **A new one**: you can make one in Settings at any time, after a confirmation. The old one then
  stops.

**If you lose the secret key on all devices, and the recovery key, you lose the notes.** A temporary
password from an admin, a reset by mail and a sign-in link all restore the sign-in, and none of them
restores a key. The account can then only be emptied and started again. No admin and no operator can
help. That is the purpose of the design, and its largest cost.

An account that starts again has new key pairs that nothing vouches for. Notes shared with it do not
come back automatically. Each owner gets a message that the key changed, and decides if they share
again ([Sharing](#sharing)). If not, an admin could give a temporary password, start the account
again, and get all notes shared with it.

A recovery key that an organization keeps, so that a managed deployment can recover its own
accounts, is for later. It is one more wrapped copy of the account key. Nothing here must change for
it.

### Sharing

- **Inviting** a person wraps the note key to their public key, in the browser of the owner. The
  recipient decrypts the preview of the note in the invitation with it. When they accept, the key is
  wrapped again under the notes key of the recipient, as the key of their own note. Thus, the private
  key is necessary only to open an invitation.
- **Whose key it is.** The server gives out public keys. Thus, a dishonest server could give out its
  own keys. The keys of each account have a short fingerprint. The People dialog shows it, so that two
  persons can compare it. An account remembers the keys that it saw, in a list that the server keeps
  under the account key, because a device keeps nothing after its session.
- **A key that changes.** New keys are signed with the keys that they replace. The recovery key and
  the command in Settings can both do this. A client accepts such keys without a question. Nobody
  wraps to keys that are not signed in that way (an account that started again, or a server that
  gives out its own keys), until the owner of the note agrees in the People dialog. The dialog tells
  that the key of the person changed.
- **Who wrapped it.** A wrap to a public key needs no secret, and the server knows all public keys.
  Thus, a wrapped key alone tells nothing about who made it. A server could replace the key sent to a
  recipient with its own key, and read what the recipient then wrote under it.
  - Thus, the client that wraps a note key signs it, together with the id of the note, the version of
    the key and the account that it is for.
  - The client of the recipient checks that signature against the key that it remembers for the
    signer. It uses no wrapped key that fails. The note tells that its key could not be checked.
  - This applies to the key that comes with an invitation, and to each new key after
    [a person is removed](#sharing).
  - After the recipient accepts, nobody can replace the copy under their own notes key.
- **Roles**: the server enforces them, as before. It refuses a write by a viewer, whatever key they
  have.
- **Teams.** The server still changes a team share into one invitation for each member.
  - A person who joins the team later gets the invitation immediately. They get the key when the
    first client of a person who has the note is online again and wraps it for them. Until then, the
    invitation tells that it waits.
  - The same applies to a team that mirrors a group at the identity provider.
  - That client signs the key as an owner does, and the invitation names it. Thus, the client of the
    member checks it against a person that the invitation says is on the note.
- **Removing someone.** The server stops to serve them the note immediately, as before. Then the
  client of the owner makes a new note key, encrypts the title, text and document under it, and wraps
  it for the persons who stay. Older versions and comments stay under the old key, which the removed
  person already had. The old key is kept wrapped under the new key. Thus, all persons on the note can
  still read them.
- **The same occurs** each time a person who had the key stops to have the note: they leave it, or
  leave the team through which it came; they decline an invitation, or the owner withdraws it (its
  preview already gave them the key); or a live public link is revoked or expires.
- **[Public links](sharing.md#public-links)** contain a link key in the URL fragment. No browser sends
  the fragment to a server.
  - A live link stores the note key wrapped by the link key. A snapshot stores a copy of the note
    encrypted under it.
  - The link key is not the token by which the server finds the link. The server never has it. The
    copy of the owner, to copy the link again, is kept under the account key.
  - The server still controls the password, the expiry and the view limit.
  - [Share links](sharing.md), which contain the full note in the fragment, do not change.

### Collaboration

The server stops to keep and merge the shared document. It becomes a relay. Each edit arrives
encrypted under the note key. The server stores it as it came, and sends it to the other persons on
the note. The clients do the merge. Yjs merges in the same way in all places.

- **Compaction** moves to the clients. When a note has sufficient edits, a client uploads the full
  document as one encrypted snapshot. The server keeps the edits of a snapshot until the next snapshot
  arrives, and keeps the last three snapshots. Thus, a client can skip a faulty snapshot, and not lose
  the edits that the snapshot was to contain.
- **Opening a note cold** reads the newest snapshot and the edits after it.
- **Presence**: cursor states are also encrypted. The server cannot change the name inside one now,
  or see whose cursor a message moves. Thus, it adds to each relayed message its connection, and the
  id, name and color of that account. Clients show that, ignore all names inside, and accept a cursor
  only from the connection that first published it.
- **Unchanged**: who can join (the server checks, as before), the check of the editor schema version,
  `If-Match` on the note row, and the records that tell a client when a row was
  [written outside the document](collaborative-editing.md#content-written-outside-the-document).

### Images

The browser encrypts an image before it uploads it. The server stores bytes that it cannot read
([Attachments](attachments.md)).

- **The key of the image** comes from the account key of the uploader and the bytes of the image.
  The server finds the attachment by an HMAC of the bytes under the account key. Thus, if one account
  attaches the same image two times, the server still stores it one time. The stored value tells
  nothing to a person without the key.
- **The key goes in the note.** The image list of the note, encrypted under the note key, contains
  the id, key and type of each image, and its description when it has one. Thus, all persons on a
  shared note can open its images.
- **Ids and sizes stay readable.** Thus, the server can still sweep images to which no note refers.
- **The type**: the server does not read it from the first bytes now. The client records it, and the
  server serves all images as opaque bytes. The person who attached the image wrote the type in the
  note. Thus, a client that reads it does what the server did before. It accepts only the five image
  types, checks the first bytes after it decrypts, and shows nothing that fails.
- **Thumbnails and icons of link previews** come back from the server with the preview. The client
  encrypts and stores them as all other images.

### Link previews

The client already asks the server for the title, description and image of a page
(`GET /api/v1/link-preview`), and writes the card into the note itself. Thus, the flow does not
change. The card is stored encrypted, as the remaining note is. The server still sees the address at
the time when it gets it. It stores nothing. Thus, a copy of the database shows no links. But an
operator who logged those requests can see them. A preference turns previews off for an account that
does not want this.

### Reminders

The time, timezone and recurrence of a reminder stay readable to the server. The server sends a
reminder as a push message when no open app fired it ([Reminders](reminders.md#push-from-the-server)),
and it moves a repeating reminder on. They are encrypted at rest with
[the own key of the server](#the-server-key).

What the reminder is about is not readable. The push message contains the encrypted title and excerpt
of the note, and the wrapped note key. The service worker opens them with the account key on the
device. A signed-out device has no key, and shows "Reminder" with no text. For this reason, the
excerpt is a separate value. Each client that saves the text of a note saves its first 140 characters
with it. Thus, the notification is correct also after a different person edited the note.

A note with a reminder also has its key wrapped under the reminder key of the account, by the client
that sets the reminder. That copy goes when the reminder goes. A
[calendar feed](#tokens-that-carry-a-key) opens it. Thus, a feed reaches the notes that have a
reminder, and no other notes.

### Tokens that carry a key

A script, an assistant and a calendar app cannot run the client. Thus, they cannot decrypt. For them,
a token can contain a key: [API tokens](accounts.md#personal-api-tokens), [MCP](mcp.md) tokens and
[calendar feed](reminders.md#calendar-feed) addresses.

- **Made in the unlocked app.** The client makes the secret of the token, and derives a wrapping key
  from it. It sends the server the hash of the token, and the keys that the token needs, wrapped under
  that key. The server cannot open them until the token is used. The wrapping key has a different
  derivation than the hash that the server stores. The hash is a plain SHA-256 of the token, and must
  not also be the key.
- **Which keys.** An API or MCP token contains the notes key and the personal key. A calendar feed
  contains only the reminder key. No token contains the account key. Thus, no token opens the private
  keys, accepts an invitation, or wraps a key for a different token.
- **Use.** A request with the token gives the server the secret. For that request, the server unwraps
  the keys of the token in memory, decrypts what the request reads, encrypts what it writes, and keeps
  nothing.
- **What works because of it**: the REST API answers a token with readable notes, as before.
  `GET /api/v1/search` scans the notes of the account in memory. The hosted MCP endpoint keeps all of
  its tools. The calendar feed names each event by its note.
- **Signing an assistant in through the browser** wraps the key on the consent page, which runs in
  the unlocked app. The secret goes in the code, and in the tokens made from it. At each exchange, the
  server wraps the keys again for the new access and refresh tokens, and deletes the previous copies.
  Thus, the secret in a code is good one time, for two minutes.
- **What it gives away.** While such a request runs, the server can read the notes of that account.
  An operator who recorded a token can read all of them. A scope limits what the server does with a
  token, not what the key opens. Settings tells this when you make a token. An account with no token,
  feed or assistant has no such door. A revocation of a token deletes its wrapped keys.
- **What a revocation cannot undo.** A person who had a token and a copy of the database from the time
  when it worked keeps the keys of that token permanently. The notes key also opens what is written
  later. When you revoke a token because it leaked, Settings offers to
  [replace every key](#changing-keys).
- **A feed address is the weakest of these.** It is a secret in a URL. The calendar service that gets
  it has it, and each proxy on the way has it. For this reason, it contains only the reminder key. The
  request log of the server, which records paths, does not record the secret of this one.

The session of the app never sends a key. Thus, the app searches in memory as before
([Search](search.md)), and `GET /api/v1/search` answers only tokens.

### Webhooks

A [webhook](webhooks.md) fires on a change in the app, when the server has no key. It contains the
event, the id of the note and the fields that the server reads. It contains no title, text or tags. A
receiver that needs them reads the note with an API token. The server must read the secret of the
webhook again to sign a delivery. Thus, the key of the server encrypts it.

### The server key

The server must read some values by itself: reminders, webhook secrets, the secrets of authenticator
apps, the key that signs push messages, and the keys of each push subscription. They are AES-256-GCM
under one **server key** that is never in the database.

- The operator gives it (`DATA_ENCRYPTION_KEY`). Or, the server makes one on the first start, and
  writes it to its own key file.
- At start-up, the server tells where the key is, and that you must make a backup of it separately
  from the database.
- It shows a warning when the key file is in the same directory as the database or its backups. There,
  a copy of one also contains the other.

To replace it, give the server the new key and also the previous key
(`DATA_ENCRYPTION_KEY_PREVIOUS`). Each value contains the id of its key. A job at start-up moves the
old values to the new key. The log tells when you can remove the previous key.

If you lose the server key, you lose reminder times, webhooks and authenticator set-ups. You can make
these again. You lose no note. The server makes the key that signs push messages again the first time
that it sends one, in place of the key that does not open now. Thus, devices subscribe to reminders
again.

### What it does not protect

- **A server that serves a changed client.** Most people load the app from the same server that
  stores their notes. A client changed to send the key away looks the same.
  - The client is a static build. You can host it separately from its server
    ([Client Deployment](../client/deployment.md)): a person that the user trusts can host it, or the
    user can. The operator must permit that address in `CORS_ORIGINS`.
  - For a person who loads the app from the operator, the design protects against all that reads the
    database, but not against an operator who changes the code.
- **A replaced public key** the first time that two people share, unless they compare the
  fingerprints. After that, a replacement is a key that changed without a signature, which a client
  refuses until the owner agrees. The same first time is the limit of the check of who wrapped a note
  key. The client checks a signature from an unknown person against the key that the server gives for
  them.
- **Who is in a team.** The server tells who is in a team (an admin tells it, or the identity
  provider). Clients wrap the key of a team note for the persons that it names. An admin who adds an
  account to a team gets the notes shared with that team, as before. The People list of the note shows
  each member who has it.
- **Requests with a token**, as [above](#tokens-that-carry-a-key).
- **What the server reads**:
  - Which notes and images exist, who owns them, and with whom they are shared.
  - Their size, when they changed, the [format](../data-model.md#format) of their words, their pin,
    archive and trash state, which notes have a reminder, and (for the running server) when it is due.
  - The id of a note is a ULID, which contains the time of its creation.
  - The address of a link at the time when the server gets its preview.
  - Usernames, names and email addresses, teams and their members, and the audit log.
  - How many versions and comments a note has, who wrote each and when, and the times when a person
    edits a note.
- **A page that is not from the server.** The user types the secret key at sign-in. Thus, a false
  sign-in page can collect it with the password. A passkey protects the sign-in from this, but not the
  secret key.
- **The device.** A signed-in browser profile has the secret key, the account key and the notes in
  memory. A device that is stolen while it is off keeps the keys until its session would have expired.

### Changing keys

- **Only the secret key** or **only the recovery key**: a new one made in Settings wraps the account
  key again, as above. This is for a lost key while you still have the other key.
- **All keys at the same time**. The recovery key does this. A command in Settings also does it, for a
  key or a device that a different person possibly has:
  - The browser makes a new account key and key pairs, and a new secret key and recovery key. It signs
    the new public keys with the old keys.
  - It encrypts the tags, colors and preferences of the account again, and wraps the keys of its notes
    again.
  - It then gives each note that the account owns a new note key, as when
    [a person is removed](#sharing). Thus, the old keys open nothing written from then on. Images that
    are already attached keep their keys.
  - All other devices are signed out. All tokens, feed addresses and assistants are revoked.
  - Notes shared with the account keep their note keys, because their owners must change them. They
    are wrapped again with the new keys of the account. The client of the owner wraps an invitation
    that is not accepted yet to the new public key again. This has the same wait as for a person who
    joins a team.
  - The work runs one batch at a time, and continues after an interruption. The old account key is
    kept, wrapped under the new key, until nothing is under it.
- **A note key**: when a person is removed, as in [Sharing](#sharing).
- **The server key**: as [above](#the-server-key).

### A server from before encryption

The server does not encrypt notes written before encryption in their place. It does not upgrade a
server from before encryption in place. The encrypted version starts on an empty database, and each
person moves their own notes.

- **Before the upgrade**, each user exports their notes from Settings
  ([Export and Import](export-import.md)). The zip contains their notes with the images, the archive,
  the trash, and the version history.
- **After it**, they sign in to an account on the new database, which is encrypted from its first
  sign-in, and import the zip. The browser encrypts each note when it stores it, as for all notes
  written there.
- **What does not come across**: notes that a different person shared (their owner imports and shares
  them again), comments, and tokens, feed addresses, webhooks and public links (the user makes them
  again). The admin also makes the accounts again.
- **The old database** and its backups are the readable copy. The operator keeps them until all
  persons have their notes, and then deletes them.
- **A server that starts on a database from before** refuses to start, and tells why. Thus, readable
  notes are never together with encrypted notes.

We decided not to change rows in place. The old text would stay in the free pages of the database and
in all older backups. Also, the client would have to accept readable rows together with encrypted
rows, for as long as an account did not sign in.

### Order of building

1. Keys and unlocking: the account key, the key pairs, the secret key, the recovery key (in place of
   the two-factor recovery codes), the sheet, the keys kept on a device, and set-up at sign-in.
2. Notes: title, text, excerpt, font, tags, color, versions and preferences.
3. Images.
4. Sharing: wraps to public keys, fingerprints, the wait for a key, a new note key on removal,
   comments and public links.
5. Collaboration as a relay, with snapshots.
6. Tokens that carry a key (API, MCP, the calendar feed), and webhooks without content.
7. The server key, and push messages with an encrypted title and excerpt.
8. Replacement of the account key.

Steps 2 to 7 are released together. A server that is half complete would contain notes that its own
features cannot read.

### What is built so far

Steps 1 to 7 are built and released in 0.6.0. Step 8, the replacement of the account key, is not
built. Some parts are narrower than the sections above describe. Each item below tells where:

- **Sealed in the browser**: the title, text, excerpt, font, link previews and list of images of a
  note, under its note key; its tags and color, under the personal key of the reader; its versions;
  and the preferences of the account. The server refuses all other values in their place. It refuses
  to start on a database that contains notes from before. It has no search, export or admin export of
  notes.
- **Images** are sealed before upload. Each is under a key made from the account key and the bytes
  of the image, and the server finds it by an HMAC of them. The note contains the key and the type.
  The server stores and serves bytes with no stated type, and the client checks what it opens.
- **The shared document** in which a note is edited is sealed. The readable document stays in the
  browser. The server syncs and stores a list of sealed edits and snapshots, with sealed cursors next
  to it. This is narrower than [Collaboration](#collaboration) describes in one way: the server still
  runs Yjs for the room, and merges the list of sealed entries. Thus, the clients that compact a note
  follow the rules about which edits and snapshots to keep. The server does not enforce them.
- **Nothing that a person writes goes to the server readable now**, other than in a request with a
  token that carries a key.
- **Sharing a note** gives its key to the recipient. It is wrapped to the public key of the recipient
  and signed by the person who wrapped it. The client of the recipient opens and checks it, and keeps
  it under their own notes key when they accept. A member of a team waits until the first client of a
  person who has the note wraps it for them. The mail of an invitation does not name the note now.
- **A note gets a new key** when a person who had the old key stops to have the note, or when a live
  public link is revoked.
  - The server marks the note. The first device of its owner that sees the mark seals the title,
    text, images and previews again under a new key.
  - It keeps the old keys sealed under the new key, for the versions, comments and edits that were
    written under them.
  - It gives the new key to the links that stay and, when they come online, to the persons still on
    the note.
  - A note keeps its last 1024 keys. After that, the oldest keys go, and what was written under them
    does not open now.
  - This is narrower than [Sharing](#sharing) describes in two ways. The shared document is not sealed
    again. Thus, the text typed before stays in the log under the old key, until the clients compact
    it away. A live link that expires, as opposed to a revoked link, does not mark the note.
- **Whose key it is.** An account remembers the public keys of the people with whom it shares, in a
  list that the server keeps sealed under the key of the account.
  - The client takes the first key that it sees for a person. Nobody wraps to a different key later,
    and it checks no signature, until the person agrees to it in the People dialog. The dialog tells
    that the key changed, and shows its fingerprint.
  - The same dialog shows the fingerprint of each person, to compare.
  - Two limits: the client never takes a new key without a question, because keys are not signed with
    the keys that they replace yet (that comes with
    [the replacement of the account key](#order-of-building)). Also, if a server removes an entry from
    the list, the client sees that person for the first time again. Only a comparison of fingerprints
    finds this.
- **Public links** contain a link key in the fragment of their address. A live link stores the note
  key wrapped by it. A snapshot stores a copy of the note sealed under a key derived from it. The copy
  of the link key of the owner is sealed under their personal key. The page opens the note, and its
  pictures, in the browser.
- **Comments** are sealed under the note key. Each is bound to an id that its writer selected.
- **Notes not stored yet**: the draft of the composer, and new notes that wait for the server, are
  kept on the device sealed under a key derived from the account key. They stay after a session that
  the server ended. A note in the queue while the account key is replaced (step 8) would not open
  after that. Nothing seals them again yet.
- **An API or MCP token made in Settings** contains the notes key and the personal key, wrapped under
  a key derived from its secret. The app makes the secret. The server never sees it until the token is
  used. For a request with the token, the server opens and seals notes in memory. Notes, versions,
  comments, sync, import and `GET /api/v1/search` work as before, and the MCP tools work too.
  Webhooks contain no content.
- **The address of a calendar feed** is made in the app, as all tokens that carry a key. It contains
  only the reminder key.
  - A note with a reminder has its key wrapped under the reminder key of its reader, by the client
    that sets the reminder. The copy goes when the reminder goes, and when the key of the note is
    replaced.
  - A reminder that a script set has no copy, because the script has no reminder key. A device of the
    account leaves one the next time that it sees the note. Until then, the feed calls that event
    "Reminder".
- **An assistant signed in through the browser** contains the same two keys. The consent page makes
  the code, and wraps the keys under it. The server gets the hash of the code, and sees the code for
  the first time when the assistant trades it in. At that exchange, and at each refresh, the server
  wraps the keys again for the new access and refresh tokens, and writes over the previous copies.
- **Images through a token**: a token sends an image as it is, and the server seals it.
  - The key is made for that image, and kept with it, wrapped under the notes key of the account,
    until a note names the image and takes the key into its sealed list.
  - To read one, the token tells in which note it is, and gets the image itself.
  - The server stores such an image one time for each upload, because its key does not come from its
    bytes.
  - A token cannot attach an image to a note that a different person owns.
- **Not built for tokens yet**: Settings does not offer to replace all keys when you revoke a token,
  because that is step 8.
- **A push message** for a reminder contains the sealed title and excerpt of the note, and the wrapped
  copy of the note key of the reader, with words that only tell that there is a reminder. The service
  worker opens them with the account key that the device keeps while it is signed in. It shows the
  title and the start of the text. A device without the key shows only the words. If a message is
  too large for a push service, it loses the excerpt first, and then the title.
- **The server key** seals what the server reads by itself: reminder times, webhook secrets,
  authenticator secrets, the key that signs push messages, and the keys of push subscriptions. It
  belongs to the operator (`DATA_ENCRYPTION_KEY`), or is in a key file made on the first start. Each
  value names its key, and a start-up moves all values to the current key.
- **Using the recovery key** replaces the secret key and the recovery key, and keeps the account key
  and the key pairs. The replacement of those is step 8, which must encrypt again what is under them.

## What it costs

- **Notes can be lost permanently**: if the secret key and the recovery key are both gone, no admin
  can bring them back.
- **One more step**: the user enters the secret key at each sign-in (a minimum of one time each 90
  days on each device), and keeps a sheet.
- **HTTPS is necessary** for connected mode.
- **The admin export goes** (`ADMIN_EXPORT`): the server has no readable data to give. A user exports
  their own notes from the app, as before.
- **Webhooks contain no content**, and the recipes that used it read the note with a token.
- **Joining a team** can mean a wait for a key.
- **The server checks less**: it cannot validate what is inside a note, or search it for the app.

## Why not a choice

We examined encryption for some accounts, or for single locked notes, and decided not to do it
([Non-goals](../non-goals.md)). Either one makes two types of note. Each feature above would then need
two implementations: one where the server reads the note, and one where it does not.

An earlier form of this design had the server encrypt all data with its own key. It kept each feature
as it was, and asked nothing of the user. But it let the operator of the server of a different person
read all notes. [The server key](#the-server-key) is what stays of it.
