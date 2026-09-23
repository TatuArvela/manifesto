# Encryption

**Decision: end-to-end encryption is a non-goal.** Manifesto does not encrypt notes so that only their
owner can read them, not as a mode and not as opt-in "locked notes". This page says why, what protects
notes instead, and what would have to be true to revisit it.

## What is protected

- **In transit**: connected mode is meant to be served over HTTPS; the client refuses nothing, but every
  deployment guide puts TLS in front of the server (see [Server Deployment](../server/deployment.md)).
- **At rest on the server**: whatever the operator's disk, volume or managed database provides. A
  self-hoster who runs the server on an encrypted volume gets encryption at rest without Manifesto
  knowing.
- **At rest in open mode**: `localStorage` is as private as the browser profile and the device it is on.

The server operator can read every note on their server. For a self-hosted instance that is the user
themselves; for an organisation's deployment it is the organisation, which is what managed mode is for.

## Why not

End-to-end encryption means the server holds ciphertext it cannot read, and several features exist only
because it can:

- **Server search**: `/api/search` reads a word index of each note's text
  ([Search](search.md)). A server that cannot read a note cannot index it.
- **Link previews**: the server fetches the pages a note links to ([Link Previews](link-previews.md)),
  which needs the URLs.
- **Live collaboration**: Yjs merges edits on the server and stores the document state there
  ([Collaborative Editing](collaborative-editing.md)). Encrypted updates can be relayed, but not
  merged, compacted or loaded by a client that joins cold.
- **Sharing between accounts**: each recipient would need the note's key, wrapped for them, which
  means key pairs per account, a key directory, and re-wrapping on every share and role change.
- **Recovery**: an admin can issue a temporary password today ([Accounts](accounts.md)). With
  end-to-end encryption a forgotten password is a lost account, unless recovery keys are added, which
  most users of a sticky-note app will not keep.

"Locked notes" (encrypt some notes, as Standard Notes and Apple Notes do) avoid a global mode but not
these costs: a locked note would drop out of search, previews, collaboration and sharing, need its own
passphrase and unlock flow, and have no recovery. The version history, the attachment store and the
export would each need a second path for it. That is a large, permanent surface for a feature whose users
are better served by an app built around it.

## What would change this

Revisit if all of these hold: users of self-hosted instances ask for it (their own server already keeps
their notes from third parties), the collaboration layer can merge without reading (an encrypted CRDT
the project is willing to depend on), and there is a design for sharing and recovery that does not turn
a lost passphrase into lost notes. Until then, anyone who needs notes the server cannot read should run
open mode, or their own server on storage they control.
