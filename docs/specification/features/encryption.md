# Encryption

**Status: planned before 1.0.0, design chosen, not yet built.** Today Manifesto does not encrypt notes
itself. This page says what protects notes now and the design chosen: the server
[encrypts everything it stores](#the-design-everything-encrypted-at-rest), notes and images alike, so
that a copy of its database or its files is unreadable on its own. It also says why the design stops
short of [end-to-end encryption](#why-not-end-to-end).

Where security and convenience pull apart, security wins: the design makes the server's own search
slower, and that is accepted.

## What is protected today

- **In transit**: connected mode is meant to be served over HTTPS; the client refuses nothing, but every
  deployment guide puts TLS in front of the server (see [Server Deployment](../server/deployment.md)).
- **At rest on the server**: whatever the operator's disk, volume or managed database provides. A
  self-hoster who runs the server on an encrypted volume gets encryption at rest without Manifesto
  knowing.
- **At rest in open mode**: `localStorage` is as private as the browser profile and the device it is on.

The server operator can read every note on their server. For a self-hosted instance that is the user
themselves; for an organisation's deployment it is the organisation, which is what managed mode is for.
Admins, as distinct from the operator, cannot read notes from inside the app unless the server allows
it; [Privacy](privacy.md) has the details.

## The design: everything encrypted at rest

Every account's notes and images are encrypted before they are stored, on every server, without the
user doing anything. The running server holds the keys and reads the notes, which is how sharing,
collaboration, previews and webhooks keep working. It protects what leaves the running server: a stolen
database file or dump, a backup in the wrong hands, a disk thrown away, and a query that reads rows it
should not (an injection, a misconfigured replica).

### Keys: a server key outside the database, a data key per account

- The server has one **server key** (256 bit), which is never in the database. The operator supplies
  it (`DATA_ENCRYPTION_KEY`), or the server makes one on first start and writes it to a key file of
  its own, and says at start-up where it is and that it must be backed up apart from the database.
- Each account has a random **data key**, stored on the user's row wrapped by the server key.
- Everything of the account's is AES-256-GCM under its data key, with the row's id as associated
  data, so a ciphertext cannot be moved to another row: a note's title and text, its versions, its
  persisted Yjs state, its link previews and its comments. A shared note is under its owner's key;
  the server opens it for whoever the note is shared with. Webhook secrets, which have to be read
  back to sign a delivery and so cannot be hashed, are encrypted the same way.
- What stays in the clear is what the database has to sort, join and filter by: ids, owners, tags,
  colour, pin, archive and trash state, reminder times, timestamps.

A key kept in the clear on the user's row was the alternative, and it protects nothing: whoever has the
rows has the keys beside them. Wrapping the data key with a key the database never holds is what makes
a copy of the database useless on its own. The data key per account, rather than the server key used
directly, means [replacing the server key](#changing-keys) re-wraps one small value per account and
touches no note, and deleting an account's data key makes its notes unreadable in every backup already taken.

### Images

An image's bytes are encrypted like a note's text: AES-256-GCM under its owner's data key, with the
attachment's id as associated data. That covers everything in the attachment store
([Attachments](attachments.md)): attached images, drawings, and the thumbnails and favicons of link
previews.

- **The content address is keyed.** An attachment is found by the SHA-256 of its bytes within its
  owner's store, so the same image sent twice is stored once. A plain hash would let anyone holding
  the database check whether an account has a picture they already know. It becomes an HMAC-SHA-256
  of the bytes under the owner's data key: the same image still resolves to the same attachment, and
  the stored value says nothing to someone without the key.
- **Type and size stay readable.** The image type is kept beside the bytes to serve them, and the
  ciphertext is as long as the image.
- **Reading is unchanged for the client.** `GET /api/attachments/:id` decrypts and returns the image,
  to the same people as now and with the same caching. The server reads an upload's type from its
  leading bytes before encrypting it, as now.

### Search

The app's own search is untouched: the client searches the notes it holds in memory
([Search](search.md)), and they reach it decrypted. What changes is `GET /api/search`, which API
clients and the MCP `search_notes` tool use. The database cannot match text it cannot read, so it
stops being a query: the server reads the account's notes (and the notes shared with it), decrypts
them and matches in memory, then pages the result as now. That is linear in the number of notes and
slower than the `LIKE` it replaces; it is the price, and it is paid. An index of hashed words would
keep the search in the database and would tell anyone holding the database which notes share which
words, so it is not used.

### What it does not protect

- Anything from the operator, or from someone who takes over the running server: they have the server
  key. See [Why not end-to-end](#why-not-end-to-end).
- A backup that carries the key file beside the database. The start-up message and
  [Server Deployment](../server/deployment.md) say to keep them apart.
- Which notes and images exist, whose they are, how large, how tagged, and when they changed.
- Open mode: a browser has nowhere to keep a key apart from `localStorage` and IndexedDB, so open
  mode's notes and images are as private as the browser profile, as today.

Losing the server key loses every note and image on the server, as losing the database would. It is
the one new thing an operator has to keep.

### Changing keys

There are two keys, and replacing each answers a different loss.

**Replacing the server key** is the routine one: on a schedule, when an operator leaves, when the key
turns up somewhere it should not be.

- The server takes the current key and, beside it, the one before (`DATA_ENCRYPTION_KEY_PREVIOUS`).
- Each wrapped data key carries the id of the server key that wrapped it, a short fingerprint of that
  key, so the server knows which of the two opens it.
- A job at start-up re-wraps every data key that carries the previous id: one small write per account,
  and no note or image is touched. Both keys work while it runs, and an interrupted job goes on from
  where it stopped.
- When no data key carries the previous id, the server says in its log that the previous key can be
  removed. Started without a key that some data key still needs, it refuses to start and says which.

Someone who already holds the old server key and an old copy of the database holds the data keys
themselves, and re-wrapping takes nothing back from them.

**Replacing the data keys** is for that case, where the key and the database leaked together.

- It is a command the operator runs from the CLI, for one account or all of them, never a schedule:
  it rewrites everything the account has stored.
- The account gets a new data key and keeps the old one, both wrapped, until the work is done. Every
  row and image carries the **key version** it was encrypted under, so the server reads old and new
  while the command runs, and after an interruption it goes on with what still carries the old
  version.
- An image's content address depends on the data key, so it is rewritten with the image.
- When nothing carries the old version, the old data key is deleted.

A backup taken before either change opens with the keys of its day, and nothing done afterwards alters
that.

What needs no key change: a new password (no key is derived from it); a key wearing out (AES-GCM under
random nonces is good for billions of messages per key, which no account's data key approaches); and
deleting an account, where deleting its data key is what makes its notes unreadable in backups.

### Moving an existing server over

Rows and images written before this are encrypted by a job at start-up, a batch at a time. A row or
image with no key version is one not yet encrypted, so the server reads both kinds while the job runs
and after an interruption. An image's content address is rewritten in the same step.

### Order of building

1. The server key and the data keys: reading the key or making the key file, wrapping, the key id,
   and replacing the server key.
2. Note text, versions, Yjs state, link previews, comments and webhook secrets, each with its key
   version, with the start-up job and `/api/search` in memory.
3. Images: the bytes, the keyed content address, and their part of the start-up job.
4. The command that replaces data keys. It can follow the rest, because the key version it needs is
   on every row and image from step 2.

## Why not end-to-end

End-to-end encryption means the server holds ciphertext it cannot read, so that not even the operator
can open a note. It was designed for, both as a mode for the whole account and as notes locked one at a
time, and decided against ([Non-goals](../non-goals.md)). Several features exist only because the server
can read a note, and each would have to be given up or built a second time:

- **Link previews**: the server fetches the pages a note links to ([Link Previews](link-previews.md)),
  which needs the URLs.
- **Live collaboration**: Yjs merges edits on the server and stores the document state there
  ([Collaborative Editing](collaborative-editing.md)). Encrypted updates can be relayed, but not
  merged, compacted or loaded by a client that joins cold.
- **Sharing between accounts**: each recipient would need the note's key, wrapped for them, which
  means key pairs per account, a key directory the server vouches for, and re-wrapping on every share
  and role change.
- **Recovery**: an admin can issue a temporary password today ([Accounts](accounts.md)). With
  end-to-end encryption a forgotten passphrase is lost notes, unless recovery codes are added, which
  most users of a sticky-note app will not keep.
- **Webhooks, MCP, the API and the admin export**: each sends a note's content out of the app
  ([Webhooks](webhooks.md), [MCP](mcp.md), [Privacy](privacy.md)); for an encrypted note they could
  carry only ciphertext or metadata.

Locking single notes keeps those features for the other notes, and adds a second kind of note with its
own passphrase, unlock flow, storage path, history and export, to protect against one reader: the
operator. A web app is also delivered by its server on every load, so an operator who wants to read a
locked note can serve a client that sends it. Encryption at rest protects every note against the
readers it can be protected from, with nothing for the user to do or to lose.

Anyone who needs notes that no server can read should run open mode, or their own server on storage
they control.
