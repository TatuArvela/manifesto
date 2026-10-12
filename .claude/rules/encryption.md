---
paths:
  - "packages/shared/src/api/keys.ts"
  - "packages/shared/src/api/sealed.ts"
  - "packages/shared/src/crypto/**"
  - "packages/client/src/utils/seal.ts"
  - "packages/client/src/utils/userKey.ts"
  - "packages/client/src/utils/keyMaterial.ts"
  - "packages/client/src/storage/deviceKeys.ts"
  - "packages/client/src/storage/sealing.ts"
  - "packages/client/src/storage/shareKeys.ts"
  - "packages/client/src/state/sharing.ts"
  - "packages/client/src/state/comments.ts"
  - "packages/client/src/state/publicLinks.ts"
  - "packages/client/src/components/ShareDialog.tsx"
  - "packages/server/src/routes/publicLinks.ts"
  - "packages/client/src/realtime/sealedDocument.ts"
  - "packages/client/src/realtime/yjsSession.ts"
  - "packages/server/src/routes/shares.ts"
  - "packages/server/src/routes/noteCodec.ts"
  - "packages/server/src/routes/tokens.ts"
  - "packages/server/src/test/keyedTokens.ts"
  - "packages/client/src/state/apiTokens.ts"
  - "packages/server/src/calendar/routes.ts"
  - "packages/server/src/oauth/tokenEndpoint.ts"
  - "packages/client/src/state/oauth.ts"
  - "packages/client/src/swPush.ts"
  - "packages/server/src/jobs/pushReminders.ts"
  - "packages/server/src/storage/atRest.ts"
  - "packages/server/src/storage/serverKey.ts"
  - "packages/server/src/storage/noteMapping.ts"
  - "packages/client/src/storage/RestApiAdapter.ts"
  - "packages/server/src/attachments/store.ts"
  - "packages/server/src/routes/attachments.ts"
  - "packages/client/src/state/accountKeys.ts"
  - "packages/client/src/test/plainSealing.ts"
  - "packages/client/src/test/sealedServer.ts"
  - "packages/client/src/components/KeyScreen.tsx"
  - "packages/client/src/components/KeySheet.tsx"
  - "packages/client/src/components/RecoveryForms.tsx"
  - "packages/client/src/components/settings/KeysSettings.tsx"
  - "packages/server/src/auth/accountKeys.ts"
  - "packages/server/src/openapi/keys.ts"
  - "packages/server/src/sharing/emptyAccount.ts"
  - "packages/server/src/storage/accountKeysMapping.ts"
  - "packages/server/src/storage/noteMapping.ts"
  - "packages/server/src/storage/*/accountKeysRepo.ts"
  - "packages/server/src/storage/contracts/accountKeysContract.ts"
  - "packages/server/src/storage/contracts/claimed.ts"
  - "packages/server/src/test/sealingClient.ts"
  - "docs/specification/features/encryption.md"
---

# Encryption

The design is `docs/specification/features/encryption.md`: end to end, for every account in
connected mode, built in the order its last section gives. Its "What is built so far" says which
steps are in and what still reaches the server readable, and has to be kept true as each step
lands. Until they all have, nothing here is released.

## Unlocking

Signing in opens nothing. `keyState` (`state/accountKeys.ts`) is what `App` shows the board on:
`setup` for an account with no keys (the browser makes them and shows the sheet once), `locked` until
the secret key is entered, `unlocked` after. It follows the session through one effect, so a
sign-out and a session the server ended both remove the keys with no caller having to remember; a
new way in only has to set `authToken`. A flow that already holds the keys when it signs in (the
recovery key from the sign-in screen) sets them before `adoptSession`, so the check that follows
finds the account unlocked instead of asking for a key. Whatever changes what the device holds goes
through `setHeld`, which is also what tells the storage layer (`storageKeys`).

Every key is shown once, on a sheet (`KeepSheetStep`), and the write that makes it real comes after
the user says they kept it: set-up and both recoveries prepare first and complete second. Keep that
order for any new flow that makes a key someone has to hold.

## What never happens, and what each is guarded by

- **The account key is never readable.** `utils/keyMaterial.ts` hands it out wrapped (for the server)
  or as a `CryptoKey` that derives and cannot be exported (for the device). Its raw bytes live inside
  one function and are overwritten in a `finally`. Re-wrapping therefore opens the server's copy with
  the secret key the device holds (`withAccountKey`); do not make the key extractable to save that.
- **The server never sees a key a person holds.** The secret key and the recovery key
  (`utils/userKey.ts`) are random, about 138 bits, which is why a plain HKDF is enough and no
  passphrase may ever stand in for one. The recovery key proves itself with a verifier derived apart
  from the key that wraps, and the server keeps the verifier's SHA-256.
- **A ciphertext does not open anywhere else.** Everything goes through `seal` / `unseal`
  (`shared/src/crypto/seal.ts`): AES-256-GCM, a random nonce a value, and `associatedData` naming
  the row, the field, the key version and the account. `unseal` answers null for every failure and
  never throws. A key for each job comes from `accountSubkey`; a new job is a new purpose, never a
  reused key.
- **Nothing above the storage layer holds a ciphertext, and nothing below it a readable note.**
  `storage/sealing.ts` (`Sealer`) seals what `RestApiAdapter` sends and opens what it and the app
  socket receive; the store, the views and the editor deal in `Note` as in open mode. A new request
  that carries a note's words goes through the `Sealer`, never around it.
- **The server stores only what is shaped as a ciphertext** where one belongs: `sealed` in
  `validation/schemas.ts` on the way in, and `sealedColumn` (`storage/noteMapping.ts`) on the way
  out, so a column's readable default is never sent as a value.
- **What is opened is checked.** It was written by some client and checked by no server, so
  `shared/src/crypto/noteSeal.ts` holds every opened value to what a note may hold and leaves out
  one that fails, and refuses to seal one past those limits (`NoteLimitError`), since the server can
  no longer count inside a field. A link preview's `domain` is among them: `checkedLinkPreviews`
  always writes the host of its `url`, since the card shows it as where the link goes.
- **A device holds keys only while signed in.** `storage/deviceKeys.ts` keeps them in IndexedDB
  with the day the session ends at the latest (`sessionEndsAt` from `GET /api/auth/keys`), and
  `checkAccountKeys` removes a copy that is another account's or past that day.

## A note on the wire

`SealedNote` (`shared/src/api/sealed.ts`) is what the server stores and what a session sends and is
sent. Title, text, excerpt, font, the image list and link previews are under the note key; colour
and tags under the reader's personal key, and `""` when never set (a recipient's start that way).
The note key is 256 random bits, wrapped under its holder's notes key in `key`. Three things follow
from sealing, each easy to get wrong:

- **The client chooses a note's id**, and a version's, because every sealed value is bound to the id
  of its row. The server cannot hand out a new one, which is why an import answers `taken` and the
  client seals again.
- **A sealed list travels with the references it names** (`images` with `imageRefs`, `linkPreviews`
  with `previewRefs`), which are the server's only record of which attachments a note uses, and the
  text travels with its excerpt. The schema refuses one half without the other.
- **A note already on the server is written under the key it has** (`Sealer.sealOver`, and
  `sealUpdate` reading the key first when the device has not opened the note): a new key would
  orphan its versions.

## Images

An image is sealed before upload (`shared/src/crypto/imageSeal.ts`): its key is an HMAC of its bytes
under a key of the account's, and its address a second HMAC, so one account stores an image once and
the address says nothing. The server keeps bytes of no stated kind (`attachments.sha256` holds the
address, `content_type` is always `application/octet-stream`), and no longer sniffs a type: the
sealing client does (`sealImage` refuses what is not one of five image types) and the opening client
does again (`openImage`), since the type in a note is whoever attached the image's word.

In the app a note still names its images as `attachment:<id>` strings, in `images` and in a
preview's `image` / `favicon`. The key and type of each wait in the `Sealer`'s `imageKeys`, filled
from every note it opens and every upload it makes, and are sealed back into the note with the
reference. A note that names an image the device has no key for is refused, not sent without one.

A sealed note cannot have a reference rewritten under it, so the old copy-on-write in `claimImages`
is two steps: the client asks `POST /api/attachments/claim` for the owner's own reference before it
seals (`RestApiAdapter.claim`, `adoptImages`), and the write then refuses any reference that is not
the owner's (`claimImages`). A new path that puts an image in a note goes through `withUploads`, or
it will meet that refusal on a shared note.

## Sharing

Everyone on a shared note needs its key (`shared/src/crypto/shareSeal.ts`). It is wrapped to the
recipient's ECDH public key through an ephemeral key (`offerNoteKey`) and signed with the wrapper's
ECDSA key over the note, the version, the recipient and the wrap; the recipient's client uses none
whose signature fails (`Sealer.adoptOffered`), since wrapping to a public key proves nothing about
who wrapped. The server stores the offer on the share row (`offered_key`) and, once accepted, the
recipient's own copy under their notes key (`wrapped_key` at `wrapped_key_version`).

- A recipient is sent `key` only while their copy is the key the note is under (`rowToViewNote`);
  behind it they get `key: ""` and the current offer, which `Sealer.open` takes through the handler
  `storage/shareKeys.ts` registers, and stores with `PUT /held-key`.
- The requests live in `shareKeys.ts`, not `sealing.ts`: sealing must not import `apiRequest.ts`
  (it would close a cycle through `storage/index.ts`).
- `state/sharing.ts` shows an invitation only once its key checked and opened (`Invitation.waiting`
  otherwise), accepts with the held key, and supplies a key to whoever on a note is
  `waitingForKey`, as the owner or as any other holder.
- Any note the server answers with outside the adapter (the share routes) is opened with
  `sealer.peek()?.open(...)` before `receiveNote`.
- **Whose key it is.** Nothing wraps to, or checks a signature against, a key straight from
  `publicKeysOf`: `offerKeyTo` and `adoptOfferedKey` go through `trustedKeysOf`, which takes the
  first key seen for an account, remembers it (`/api/auth/keys/seen`, sealed with `sealSeenKeys`
  and bound to whose it is) and answers null for a different one later, naming the account in
  `changedKeys`. Only `trustKeys` (`state/sharing.ts`, the People dialog's button) replaces a
  remembered key, and then retries what waited on it. A list that could not be read trusts
  nobody. `PersonKey` asks for a key's status only while keys are being compared or one is
  marked changed, so opening the dialog costs no request.
- **Replacing a note's key.** Both drivers mark a note `rekey_due` inside `shares.delete` (when
  the share ever held a key, `heldKey`) and `publicLinks.delete` (a live link), so no route has to
  remember. Only the owner is sent `rekeyDue`; `Sealer.open` gathers those ids in `due`, and an
  effect in `state/sharing.ts` calls `replaceNoteKey` (`shareKeys.ts`), which sends
  `PUT /api/notes/:id/key`. `Sealer.rekey` moves the shared fields with `resealSharedFields`,
  which refuses a note any field of which does not open, so a key is never replaced over words
  this device could not read. The keys before are kept in `previousKeys`, sealed under the new
  one; versions, comments and the document's entries are opened with the key of the version they
  name (`ringOf`). The server stamps `updated_at`, so a write sealed under the old key meets a
  412, and one that states the old `keyVersion` a 409, after which `RestApiAdapter.update` reads
  the key again and seals once more. A live document is rebuilt when `Sealer.replaced` changes.
- A comment's text is sealed under the note key and bound to an id its writer chose
  (`sealComment`); `state/comments.ts` opens every comment it is sent, a socket's included, and
  leaves out one that does not open. The server cannot tell an edit to the same words from a real
  one, so the client is what leaves an unchanged comment alone.

## The shared document

`realtime/sealedDocument.ts`. The editor binds to a readable `Y.Doc` that never leaves the browser.
The `Y.Doc` given to Hocuspocus and to `y-indexeddb` is another one, whose `log` array holds that
document's edits and snapshots sealed under `NoteSealKey.edits`; the server and the offline copy
hold ciphertext. `joinSealedDocument` carries edits both ways through a queue, and
`createYjsSession` reports `synced` only once `settled()` says every arrived entry is applied: the
editor reads `synced` as "this document holds what the server has", and reporting the wire
document's sync would seed an empty editor over everyone's text.

Presence is bridged the same way (`joinSealedAwareness`): the editor's `Awareness` is local, what
crosses is `{ sealed }`, and a remote state is shown under the `user` the server stamped, never a
name from inside. Both documents share one `clientID`, so "the client with the lowest id" in
`contentAgreement.ts` is the same client to everyone.

The server's `/api/yjs` code did not change and must not start reading the document: nothing in it
is readable. Passing `key: null` to `createYjsSession` syncs the document as it is, and exists only
for tests that hand sealing through.

## Public links

A link's address is `/p/<token>#k=<link key>` (`shared/src/crypto/linkSeal.ts`). The server finds
the link by the token and never sees the key. `Sealer.publish` makes the key and what the server
stores: for a live link the note key wrapped by it, for a snapshot a copy of the note sealed under
a key derived from it, with the attachment references that copy names. The owner's own copy of the
link key is sealed under their personal key (`sealedLinkKey`), which is how the dialog copies an
address again (`publicLinkAddress`). The page has no account and no `Sealer`: `state/publicLinks.ts`
reads the key from `location.hash`, opens the note with the shared functions, and opens each
picture with the key the note holds for it. A link without its key shows the same "gone" as one
that is not there. Its browser test seals a real note for that reason, though the rest of that
project hands sealing through.

## Tokens

A script cannot seal or open a note, so a token that reaches notes carries the notes key and the
personal key (never the account key), wrapped under a key derived from its secret
(`shared/src/crypto/tokenSeal.ts`). The app makes the secret (`Sealer.newToken`,
`state/apiTokens.ts`) and sends its hash, so the server first sees it when it is used; a calendar
token and one for the account alone are still made by the server. `createAuthMiddleware` opens the
keys for the request (`auth.keys`) and nothing keeps them. `routes/noteCodec.ts` is the whole
translation: `tokenKeys(c)` is null for a session, which is answered sealed, and for a token every
note route opens what it answers and seals what it is sent. A new route that answers a note calls
`noteOut` / `notesOut`, or a token is handed ciphertext. What is written beside a note under its
key (a comment) goes through `noteRing`, `commentOut` and `commentBody` the same way; the event a
write sends still carries the sealed copy, since the sockets are the app's.

A token's images go the same way (`routes/attachments.ts`). It uploads the image itself and
the server seals it with `sealImageAtRandom`: a token carries no image keys, so the key is random
and the image is not found again by its bytes. That key is kept on the attachment row
(`wrapped_key`, `wrapImageKey`) because the server holds nothing between the upload and the note
that follows; `uploadedKeys` in `noteCodec.ts` hands it to sealing when a note names the image.
A token reads an image with `?note=<id>`, since the keys of a note's images are inside the note.

An assistant's OAuth grant carries the same keys (`oauth/tokenEndpoint.ts`). The consent page
(`allowClient`) makes the code with `Sealer.newToken("")` and sends its hash and the keys wrapped
under it, and adds `code` to the address the server answers with, which comes without one. The
exchange opens the keys as bytes (`openTokenKeyMaterial`, the one caller that needs them so) and
wraps them for the access token and for the refresh token (`refresh_wrapped_keys`); each refresh
does it again from the refresh token being spent, in the same statement that rotates the hashes.

A calendar feed's address is such a token too, carrying the reminder key alone
(`wrapFeedKey`; `calendar/routes.ts` opens it from the address). It reaches a note only through
`reminderKey`, the note key wrapped under the reader's reminder key: a personal field like the
reminder itself (on the note for its owner, on the share for a recipient), sent by `sealNew` /
`sealUpdate` whenever a reminder is set, cleared by the route when the reminder is and by `rekey`
for everyone. A note that has a reminder and no copy lands in `Sealer.feedDue`, and the effect in
`state/sharing.ts` leaves one (`leaveFeedKey`); that is the only way a reminder a script set, or
a note whose key was replaced, gets its name back in the feed.

`test/sealingClient.ts` mints a token as the app does, with real keys (`test/keyedTokens.ts`),
since the server opens with them. A note written by a session in a test is only shaped as
ciphertext, so a token reads what a token wrote; `heldKeyOf` gives a recipient a real copy of a
shared note's key.

A field added to a note's words is added in `noteSeal.ts` (seal, open, check), `SealedNote`, the
sealed schema and `SEALED_SHARED_NOTE_FIELDS` or the personal list, and `shareMapping.test.ts`
fails until someone has decided which.

## Push

A reminder nobody's open app fired is pushed by the server (`jobs/pushReminders.ts`), which
cannot read what it is about. `ReminderPush.sealed` carries the note's sealed title and excerpt
and the reader's own wrapped copy of the note key, exactly as the row holds them; `title` and
`body` beside them say only that there is a reminder. The service worker (`swPush.ts`,
`wordedPush`) opens the sealed half with the account key in `deviceKeys`, which exists only
while the device is signed in, and words it as `reminderScheduler.ts` does. Every field of a
push is checked before use (`readReminderPush`): the worker runs privileged.

## The server key

Not the account's keys: what the server has to read with nobody signed in (`storage/atRest.ts`).
A reminder's time, a webhook's secret, an authenticator's secret, the VAPID key and each push
subscription's keys are AES-256-GCM under one key that is never in the database, with the
column's purpose as associated data and the key's id in front of every value (`s1.<id>.<...>`).
`createStorage` sets the key for the process (`useAtRest`) before a driver is built; a driver
built by hand, as the storage contracts do, runs unsealed. The row mappings and five repository
methods call `atRest.seal` / `atRest.open`, and a value that does not open reads as none (no
reminder, an empty secret), never as an error that stops a listing.

A new column of that kind is sealed where it is written, opened where it is read, and added to
`AT_REST_COLUMNS`: that list is what `moveToCurrentKey` walks at start-up, so a column missing
from it is never moved when the key is replaced, and is lost with the old key. Reading a value
from before the server had a key works because anything without the `s1.` prefix is taken as it
is; the same start-up pass seals it.

`loadServerKeys` (`storage/serverKey.ts`) takes `DATA_ENCRYPTION_KEY` or a key file it makes
(`0600`, `wx`), and warns while the file sits beside the database or its backups.
`DATA_ENCRYPTION_KEY_PREVIOUS` keeps the key before readable until the move is done.

## On the server

The routes for keys are `auth/accountKeys.ts`, session-only (`openapi/keys.ts`). What checks the
recovery key goes through `recoveryKeysOf`, which counts a wrong one against the same
`loginAttempts` budget as a password and audits it. Spending a recovery key is one conditional write
(`replaceUserKeys`), so two requests holding the same key cannot both win. The recovery key took the
place of the two-factor recovery codes: an account whose only factor is passkeys has nothing to type
at sign-in. Starting an account again removes its keys and, through `sharing/emptyAccount.ts`,
everything sealed under them.

A database from before encryption is not upgraded: migration `0028-sealed-notes` carries
`refuseIf: BEFORE_ENCRYPTION`, and `index.ts` prints the refusal and exits.

## Tests

The server never opens a note, so its tests need only values shaped as ciphertext: `ct` / `plain`
in `storage/contracts/claimed.ts`, and `test/sealingClient.ts`, which sends a test's requests as the
app does (sealed on the way out, opened on the way back) so a route test still speaks of a note's
title. It uploads an image under an address made from its bytes and claims a note's images before
it writes, as the app does. `rig.rawRequest` sends a body as given, for what the server refuses.

On the client, the browser project installs `test/plainSealing.ts` for every test: those tests are
about the store, the socket and the screens, with fake servers that answer readable notes. Real
sealing is tested in the node project (`sealing.test.ts`, `RestApiAdapter.sealed.test.ts`, against
`test/sealedServer.ts`, a server that holds what it is sent and no key). `putImage` itself needs
`XMLHttpRequest`, so the node tests seal an upload with the `Sealer` and place it on that server by
hand. The browser project also needs a real IndexedDB for `deviceKeys`.
