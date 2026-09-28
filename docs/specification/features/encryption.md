# Encryption

**Status: planned before 1.0.0, design not yet chosen.** Today Manifesto does not encrypt notes so that
only their owner can read them. This page says what protects notes now, what end-to-end encryption
costs, and what a design has to answer before it is built.

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

## What it costs

End-to-end encryption means the server holds ciphertext it cannot read, and several features exist only
because it can. Each needs an answer, even if the answer is that an encrypted note goes without it:

- **Server search**: `/api/search` matches against each note's text ([Search](search.md)). A server
  that cannot read a note cannot search it.
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
- **Webhooks and the admin export**: both send a note's content out of the app ([Webhooks](webhooks.md),
  [Privacy](privacy.md)); for an encrypted note they could carry only ciphertext or metadata.

"Locked notes" (encrypt some notes, as Standard Notes and Apple Notes do) avoid a global mode but not
these costs: a locked note would drop out of search, previews, collaboration and sharing, need its own
passphrase and unlock flow, and have no recovery. The version history, the attachment store and the
export would each need a second path for it.

## What a design has to settle

- **Scope**: an account-wide mode, locked notes, or both, and which of the features above an encrypted
  note gives up.
- **Collaboration**: relaying encrypted Yjs updates, and how a client that joins cold gets the document
  without the server merging it.
- **Keys**: how a note's key is wrapped for each share recipient, and what a role change or a removal
  does to it.
- **Recovery**: what a user who forgets their passphrase keeps, stated before they turn encryption on.
- **Open mode**: whether notes in `localStorage` are encrypted too, or open mode stays as private as the
  browser profile.

Until it ships, anyone who needs notes the server cannot read should run open mode, or their own server
on storage they control.
