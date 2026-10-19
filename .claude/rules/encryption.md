---
paths:
  - "packages/shared/src/api/keys.ts"
  - "packages/shared/src/api/sealed.ts"
  - "packages/shared/src/crypto/**"
  - "packages/client/src/utils/userKey.ts"
  - "packages/client/src/utils/keyMaterial.ts"
  - "packages/client/src/storage/deviceKeys.ts"
  - "packages/client/src/storage/offlineNotes.ts"
  - "packages/client/src/storage/sealing.ts"
  - "packages/client/src/storage/imageKeyRing.ts"
  - "packages/client/src/storage/keyOffers.ts"
  - "packages/client/src/storage/linkSealing.ts"
  - "packages/client/src/storage/accountSealing.ts"
  - "packages/client/src/storage/shareKeys.ts"
  - "packages/client/src/state/sharing.ts"
  - "packages/client/src/state/comments.ts"
  - "packages/client/src/state/publicLinks.ts"
  - "packages/client/src/components/sharing/ShareDialog.tsx"
  - "packages/client/src/components/sharing/ShareMembers.tsx"
  - "packages/server/src/routes/publicLinks.ts"
  - "packages/client/src/realtime/sealedDocument.ts"
  - "packages/client/src/realtime/yjsSession.ts"
  - "packages/server/src/routes/shares.ts"
  - "packages/server/src/routes/noteCodec.ts"
  - "packages/server/src/routes/tokens.ts"
  - "packages/server/src/test/keyedTokens.ts"
  - "packages/client/src/state/account/apiTokens.ts"
  - "packages/server/src/calendar/routes.ts"
  - "packages/server/src/oauth/tokenEndpoint.ts"
  - "packages/client/src/state/account/oauth.ts"
  - "packages/client/src/swPush.ts"
  - "packages/server/src/jobs/pushReminders.ts"
  - "packages/server/src/storage/atRest.ts"
  - "packages/server/src/storage/serverKey.ts"
  - "packages/server/src/storage/noteMapping.ts"
  - "packages/client/src/storage/RestApiAdapter.ts"
  - "packages/server/src/attachments/store.ts"
  - "packages/server/src/routes/attachments.ts"
  - "packages/client/src/state/account/accountKeys.ts"
  - "packages/client/src/test/plainSealing.ts"
  - "packages/client/src/test/sealedServer.ts"
  - "packages/client/src/components/UnopenedNotes.tsx"
  - "packages/client/src/components/login/KeyScreen.tsx"
  - "packages/client/src/components/login/KeySheet.tsx"
  - "packages/client/src/components/login/RecoveryForms.tsx"
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

The design is `docs/specification/features/encryption.md`. It is end to end, for all accounts in
connected mode. We build it in the order that its last section gives. Its section "What is built so
far" tells which steps are complete, and what still goes to the server readable. Keep that section
correct each time a step is complete. Steps 1 to 7 were released in 0.6.0. Step 8, the replacement
of the account key, is not built.

## Unlocking

A sign-in opens nothing. `App` shows the board from `keyState` (`state/account/accountKeys.ts`):

- `setup`: an account with no keys. The browser makes them, and shows the sheet one time.
- `locked`: until the user enters the secret key.
- `unlocked`: after that.

`keyState` follows the session through one effect. Thus, a sign-out and a session that the server
ended both remove the keys, and no caller has to remember this. A new way to sign in only has to set
`authToken`. The effect follows the signed-in user (`signedInAs`), and runs the check `untracked`.
The reason is that each refresh of the account replaces `currentUser` fully. A new decision then
would discard a set-up or a recovery whose sheet already shows. A flow that already has the keys
when it signs in (the recovery key from the sign-in screen) sets them before `adoptSession`. Thus,
the check that follows finds the account unlocked, and does not ask for a key. All changes to what
the device holds go through `setHeld`. `setHeld` also tells the storage layer (`storageKeys`).

Tabs tell each other through a `BroadcastChannel`. `hold` announces `held` only when the copy of the
device was written. An unlocked tab that cannot read a copy keeps what it holds. A browser that
refuses IndexedDB keeps the keys only in memory. If each unlock of a different tab locked the other
tabs, the app would stop under the person who types. Only `gone` (`startAgain`) makes a tab let go.

The app shows each key one time, on a sheet (`KeepSheetStep`). The write that makes the key real
comes after the user says that they kept it. Set-up, both recoveries and a new key from Settings
first prepare (`prepareSecretKey` / `prepareRecoveryKey`) and then complete (`completeRenewal`). If a
request for a new secret key got no answer, the app takes the key as made when the wrap on the server
is the wrap that it sent. The device must continue to hold the key that opens what the server holds.
Keep that order for each new flow that makes a key that a person must keep.

## What never happens, and what each is guarded by

- **The account key is never readable.** `utils/keyMaterial.ts` gives it out wrapped (for the
  server), or as a `CryptoKey` that can derive keys but cannot be exported (for the device). Its raw
  bytes exist only inside one function, and a `finally` overwrites them. Thus, to wrap it again, the
  code opens the copy of the server with the secret key of the device (`withAccountKey`). Do not make
  the key extractable to prevent this step.
- **The server never sees a key that a person holds.** The secret key and the recovery key
  (`utils/userKey.ts`) are random, approximately 138 bits. For this reason, a plain HKDF is
  sufficient, and a passphrase must never replace one of them. The recovery key proves itself with a
  verifier that comes from a different derivation than the key that wraps. The server keeps the
  SHA-256 of the verifier.
- **A ciphertext does not open in a different place.** All encryption goes through `seal` / `unseal`
  (`shared/src/crypto/seal.ts`): AES-256-GCM, a random nonce for each value, and `associatedData`
  that names the row, the field, the key version and the account. `unseal` returns null for all
  failures, and never throws. The key for each job comes from `accountSubkey`. A new job is a new
  purpose. Never use a key again for a different job.
- **No code above the storage layer holds a ciphertext, and no code below it holds a readable
  note.**
  - `storage/sealing.ts` (`Sealer`) seals what `RestApiAdapter` sends, and opens what it and the app
    socket receive. `storage/accountSealing.ts` seals what belongs only to the keys of the account,
    and to no note.
  - The store, the views and the editor use `Note`, as in open mode.
  - A new request that carries the words of a note goes through the `Sealer`, never around it.
  - A note that does not open is not included, and `Sealer.unreadable` counts it. `UnopenedNotes`
    shows it on the board. `forget` removes it again, and all other marks that the `Sealer` had for
    the note.
  - The app refuses an export while one of the own notes of the account is among them
    (`missesOwnNotes`). The export does not include a note shared with the account, because its owner
    must make its backup.
  - `openAll` opens a few notes at a time, and keeps their order.
- **The server stores only values with the shape of a ciphertext** where one belongs: `sealed` in
  `validation/fields.ts` on the way in, and `sealedColumn` (`storage/noteMapping.ts`) on the way out.
  Thus, the server never sends the readable default of a column as a value.
- **The client checks what it opens.** A client wrote it, and no server checked it. Thus,
  `shared/src/crypto/noteSeal.ts` checks each opened value against what a note can contain (the
  lists through `noteChecks.ts`), and removes a value that fails. It also refuses to seal a value
  past those limits (`NoteLimitError`), because the server cannot count inside a field now. The
  `domain` of a link preview is one of them. `checkedLinkPreviews` always writes the host of its
  `url`, because the card shows it as the target of the link. The note key itself, the keys before
  it, and the key of an upload are in `noteKey.ts`.
- **What waits on the device is sealed.** The draft of the composer and the notes not sent yet
  (`storage/offlineNotes.ts`) are sealed under the `drafts` subkey. They are bound to the account,
  the key version, the type and the record. Thus, the device has no readable words of them. They stay
  after a 401, as the offline copies do, and open again at the next unlock. A sign-out deletes them.
  A replaced account key makes them impossible to open. Thus, step 8 must seal them again.
- **A device holds keys only while it is signed in.** `storage/deviceKeys.ts` keeps them in
  IndexedDB with the last day of the session (`sessionEndsAt` from `GET /api/v1/auth/keys`).
  `checkAccountKeys` removes a copy that belongs to a different account, or that is past that day.

## A note on the wire

`SealedNote` (`shared/src/api/sealed.ts`) is what the server stores, and what a session sends and
gets.

- The title, text, excerpt, font, image list and link previews are under the note key.
- The color and the tags are under the personal key of the reader. They are `""` when never set (a
  recipient starts in that way).
- The note key is 256 random bits, wrapped under the notes key of its holder, in `key`.

Three rules follow from the seal. It is easy to get each one wrong:

- **The client selects the id of a note**, and of a version, because each sealed value is bound to
  the id of its row. The server cannot give a new id. For this reason, an import answers `taken`, and
  the client seals again.
- **A sealed list goes with the references that it names** (`images` with `imageRefs`,
  `linkPreviews` with `previewRefs`). These are the only record of the server of which attachments a
  note uses. The text goes with its excerpt. The schema refuses one half without the other.
- **A note that is already on the server is written under the key that it has** (`Sealer.sealOver`,
  and `sealUpdate`, which reads the key first when the device did not open the note). A new key makes
  its versions impossible to open.

## Images

An image is sealed before the upload (`shared/src/crypto/imageSeal.ts`). Its key is an HMAC of its
bytes under a key of the account, and its address is a second HMAC. Thus, one account stores an image
one time, and the address tells nothing.

- The server keeps bytes with no stated type (`attachments.sha256` contains the address, and
  `content_type` is always `application/octet-stream`). It does not sniff a type now.
- The sealing client finds the type (`sealImage` refuses all values other than five image types). The
  opening client finds it again (`openImage`), because the type in a note is only what the person who
  attached the image said.

In the app, a note still names its images as `attachment:<id>` strings, in `images` and in the
`image` / `favicon` of a preview. The key and the type of each wait in the `ImageKeyRing` of the
`Sealer` (`storage/imageKeyRing.ts`). The ring gets them from each note that the `Sealer` opens and
each upload that it makes. The `Sealer` seals them back into the note with the reference. The app
refuses a note that names an image for which the device has no key. It does not send it without the
key.

Nobody can change a reference under a sealed note. Thus, the old copy-on-write in `claimImages` is
now two steps:

1. Before it seals, the client asks `POST /api/v1/attachments/claim` for the own reference of the
   owner (`RestApiAdapter.claim`, `adoptImages`).
2. The write then refuses each reference that does not belong to the owner (`claimImages`).

A new path that puts an image in a note goes through `withUploads`. If not, it gets that refusal on a
shared note. The write of a token does the first step on the server (`ownedByOwner` in
`routes/noteCodec.ts`). It moves the key that it kept with its upload to the copy of the owner.

## Sharing

All persons on a shared note need its key (`shared/src/crypto/shareSeal.ts`).

- The key is wrapped to the ECDH public key of the recipient through an ephemeral key
  (`offerNoteKey`). The ECDSA key of the wrapper signs it, over the note, the version, the recipient
  and the wrap.
- The client of the recipient uses no key whose signature fails (`Sealer.adoptOffered`, with the work
  in `storage/keyOffers.ts`). A wrap to a public key proves nothing about who wrapped it.
- A signature tells who wrapped a key, not that it is the key of the note. All persons on a note can
  wrap one. Thus, `adoptOfferedKey` also checks the key against the sealed fields of the note
  (`opensSharedFields`). `openSharedFields` reads a field that does not open as empty. If the client
  kept a wrong key, it would show an empty note, and its next edit would seal over the words of all
  persons.
- The title, the text and the excerpt that it carries must each open, not only one field. An editor
  can write only the font under their own key, and then offer that key.
- The route (`PUT /:id/shares/:userId/key`) lets all persons other than the owner give a key only to
  a person who is `waitingForKey`. The view of the owner decides this, because that view lists
  invitations.
- The server stores the offer on the share row (`offered_key`). After the recipient accepts, it
  stores the own copy of the recipient under their notes key (`wrapped_key` at
  `wrapped_key_version`).

More rules:

- A recipient gets `key` only while their copy is the current key of the note (`rowToViewNote`). When
  their copy is older, they get `key: ""` and the current offer. `Sealer.open` takes the offer through
  the handler that `storage/shareKeys.ts` registers, and stores it with `PUT /held-key`. The `Sealer`
  does not take an offer of a key that it already holds while that request did not complete.
- The requests are in `shareKeys.ts`, not in `sealing.ts`. Sealing must not import `apiRequest.ts`,
  because that makes a cycle through `storage/index.ts`.
- `state/sharing.ts` shows an invitation only after its key passed the check and opened
  (`Invitation.waiting` if not). It accepts with the held key. It gives a key to each person on a note
  who is `waitingForKey`, as the owner or as a different holder.
  - It names what it tried with the key to which the note last moved (`Sealer.replaced`). Thus, a
    second replacement gives keys to all persons again.
  - It forgets a `supplyKey` that `failed` (a request that did not get through, not `unable`), and
    tries again when the connection comes back.
  - `wrapKeyFor` tells the two apart. `lookUpKeys` answers `none` or `failed` for the public keys of
    an account, and `rememberedBy` forgets a request that failed. Thus, what it still holds tells
    which it was. A new request on the way to a key needs the same. If not, its failure reads as
    `unable`, and the app never tries again.
  - It keeps only keys that it found, and only for the `Sealer` that asked. It asks again for an
    account that has no keys yet, because that account can set them up at any time. A different
    account that unlocks in the tab starts with nothing.
- Each note that the server sends outside the adapter (the share routes) is opened with
  `sealer.peek()?.open(...)` before `receiveNote`.
- **Whose key it is.** No code wraps to a key, or checks a signature against a key, directly from
  `publicKeysOf`.
  - `offerKeyTo` and `adoptOfferedKey` go through `trustedKeysOf`. It takes the first key that it
    sees for an account and remembers it (`/api/v1/auth/keys/seen`, sealed with `sealSeenKeys`, and
    bound to its account). It answers null for a different key later, and names the account in
    `changedKeys`.
  - Only `trustKeys` (`state/sharing.ts`, the button of the People dialog) replaces a remembered key.
    Then it tries again what waited on it.
  - A key counts as remembered only after the server kept it (`remember`). The app does not trust a
    first key that the server did not keep. If the server does not take a changed key, the
    remembered key stays. An account with no entry looks new, and the app would trust its key
    without a question in the next session.
  - If the app cannot read the list, it trusts nobody.
  - `PersonKey` (`ShareMembers.tsx`) asks for the status of a key only while the user compares keys,
    or while a key has the mark changed. Thus, when the dialog opens, it makes no request.
- **Replacing a note's key.**
  - Both drivers mark a note `rekey_due` inside `shares.delete` (when the share ever held a key,
    `heldKey`), `maintenance.cleanupTrashedSharesBefore` (a share that expired from the trash of its
    recipient) and `publicLinks.delete` (a live link). Thus, no route has to remember it. A new
    statement that deletes from `note_shares` must do the same.
  - Only the owner gets `rekeyDue`. `Sealer.open` collects those ids in `due`. An effect in
    `state/sharing.ts` calls `replaceNoteKey` (`shareKeys.ts`), which sends
    `PUT /api/v1/notes/:id/key`.
  - `Sealer.rekey` moves the shared fields with `resealSharedFields`. It refuses a note if one of its
    fields does not open. Thus, a key is never replaced over words that this device could not read.
  - A server with public links off sends 404 for the links of the note. `replaceNoteKey` reads this
    as no links. It replaces the key in all cases.
  - The keys before are kept in `previousKeys`, sealed under the new key: the newest
    `MAX_PREVIOUS_KEYS` of them. The server limits the length of the list. A note that the app could
    not move again would stay under a key that a removed person still holds.
  - The app opens versions, comments and the entries of the document with the key of the version
    that they name (`ringOf`, and the function with the same name in `routes/noteCodec.ts` for a
    token).
  - The app seals the fields again from a read. Thus, the request sends the `updatedAt` of that read
    as `If-Match`. The server moves the note only if nothing wrote it after the read. If something
    did, it sends 412, and `replaceNoteKey` reads again.
  - The server sets `updated_at`. Thus, a write sealed under the old key gets a 412. A write that
    states the old `keyVersion` gets a 409 (`notes.update` takes it as `expectedKeyVersion`, a
    condition of the write itself, never a read before it; the write of a token states the key under
    which `sealedChanges` sealed). After that, `RestApiAdapter.update` reads the note again through
    `Sealer.open`, which takes the offered key of a recipient, and seals one more time.
  - An import never moves a note to a different key. The route answers `stale`, and `importAll` reads
    and seals again.
  - A live document is built again when `Sealer.replaced` changes.
  - The app keeps what `state/sharing.ts` started (`inHand`) for each unlocked `Sealer`, only while
    it runs (`setAbout`). The app tries a failed replacement again on reconnect and on the next
    unlock. A note that is due again in the same session, after a second removal, gets a second key.
- The text of a comment is sealed under the note key, and bound to an id that its writer selected
  (`sealComment`). `state/comments.ts` opens each comment that it gets, also from a socket, and
  removes a comment that does not open. The server cannot tell an edit to the same words from a real
  edit. Thus, the client does not change a comment that did not change.

## The shared document

The code is `realtime/sealedDocument.ts`. The editor binds to a readable `Y.Doc` that never goes out
of the browser. Hocuspocus and `y-indexeddb` get a different `Y.Doc`. Its `log` array contains the
edits and snapshots of the readable document, sealed under `NoteSealKey.edits`. The server and the
offline copy contain only ciphertext.

- `joinSealedDocument` moves edits in both directions through a queue.
- `createYjsSession` reports `synced` only after `settled()` says that all arrived entries are
  applied. The editor reads `synced` as "this document contains what the server has". If the session
  reported the sync of the wire document, it would fill an empty editor over the text of all persons.
- An entry that does not open is skipped by design. All editors can append junk, and they must not be
  able to stop the sync of the note. The session counts such entries. `onUnreadable` sends the count
  to `useNoteYDoc`, and the editor shows a notice.
- `compact` removes only entries under a key that the device holds. An entry that is still on the old
  key after a replacement has no edits of the new key in its snapshot. It must leave them to the
  clients that have them.
- `settled()` resolves later than the effect that asked. The socket of a destroyed session stays up
  until its last edits are sealed. Thus, each callback that `useNoteYDoc` gives to a session checks
  `cancelled`. A callback that wrote state after cleanup would mark the session of the next note
  `synced`.

The seal takes a short time. Thus, `SealedDocument.destroy` resolves when the edits already made are
in the wire document. Only then does `createYjsSession` close the provider, the offline copy and the
wire document. If they close immediately, the last keystrokes before a note closes are lost.
`NoteSealKey` derives `edits` and `presence` the first time that code asks for them, because the app
opens each note of a listing, and only an open editor needs them.

Presence uses the same bridge (`joinSealedAwareness`). The `Awareness` of the editor is local. What
goes across is `{ sealed }`. A remote state shows under the `user` that the server added, never under
a name from inside. Both documents share one `clientID`. Thus, "the client with the lowest id" in
`contentAgreement.ts` is the same client for all persons.

The wire document syncs all that `y-indexeddb` loads into it, as it is. Thus, the sealed copy has its
own name (`LOCAL_COPY_PREFIX`, `manifesto:yjs-sealed:`), separate from the readable copies that a
browser kept before the seal. `createYjsSession` deletes those (`deleteReadableNoteCopies`). A change
to what the wire document contains needs a new name in the same way. Never use the old name again.

The `/api/v1/yjs` code of the server did not change. It must not start to read the document, because
nothing in it is readable. `key: null` for `createYjsSession` syncs the document as it is. It exists
only for tests that skip the seal.

## Public links

The address of a link is `/p/<token>#k=<link key>` (`shared/src/crypto/linkSeal.ts`). The server
finds the link by the token, and never sees the key.

- `Sealer.publish` makes the key and what the server stores. For a live link, it is the note key
  wrapped by the link key. For a snapshot, it is a copy of the note sealed under a key derived from
  it, with the attachment references that the copy names.
- The seal itself is in `storage/linkSealing.ts`. The `Sealer` gives it the keys of the account.
  `linkSealing.ts` never imports the `Sealer`.
- The own copy of the link key of the owner is sealed under their personal key (`sealedLinkKey`).
  Thus, the dialog can copy an address again (`publicLinkAddress`).
- A new link comes back from `createPublicLink` with its address. The app never sends it without the
  sealed parts that `publish` makes.
- The page has no account and no `Sealer`. `state/publicLinks.ts` reads the key from
  `location.hash`, opens the note with the shared functions, and opens each picture with the key that
  the note has for it.
- A link without its key shows the same "gone" as a link that does not exist.
- For this reason, its browser test seals a real note, although the other tests of that project skip
  the seal.

## Tokens

A script cannot seal or open a note. Thus, a token that reaches notes contains the notes key and the
personal key (never the account key), wrapped under a key derived from its secret
(`shared/src/crypto/tokenSeal.ts`).

- The app makes the secret (`Sealer.newToken`, `state/account/apiTokens.ts`), and sends its hash.
  Thus, the server sees it for the first time when it is used. The server still makes a calendar
  token, and a token only for the account.
- `createAuthMiddleware` opens the keys for the request (`auth.keys`). Nothing keeps them.
- `routes/noteCodec.ts` is the full translation. `tokenKeys(c)` is null for a session, which gets
  sealed answers. For a token, each note route opens what it answers, and seals what it gets.
- A new route that answers a note calls `noteOut` / `notesOut`. If not, a token gets ciphertext.
- Data written next to a note under its key (a comment) goes through `noteRing`, `commentOut` and
  `commentBody` in the same way.
- The event that a write sends still contains the sealed copy, because the sockets belong to the
  app.

The images of a token go the same way (`routes/attachments.ts`).

- The token uploads the image itself, and the server seals it with `sealImageAtRandom`. A token has
  no image keys. Thus, the key is random, and the server cannot find the image again by its bytes.
- The server keeps that key on the attachment row (`wrapped_key`, `wrapImageKey`), because it keeps
  nothing between the upload and the next note. `uploadedKeys` in `noteCodec.ts` gives it to the seal
  when a note names the image.
- A token reads an image with `?note=<id>`, because the keys of the images of a note are inside the
  note.

The OAuth grant of an assistant contains the same keys (`oauth/tokenEndpoint.ts`).

- The consent page (`allowClient`) makes the code with `Sealer.newToken("")`. It sends its hash and
  the keys wrapped under it. It adds `code` to the address that the server answers with, which comes
  without one.
- The exchange opens the keys as bytes (`openTokenKeyMaterial`, the only caller that needs them in
  that form). It wraps them for the access token and for the refresh token
  (`refresh_wrapped_keys`).
- Each refresh does this again from the refresh token that it spends, in the same statement that
  rotates the hashes.

The address of a calendar feed is also such a token. It contains only the reminder key
(`wrapFeedKey`; `calendar/routes.ts` opens it from the address).

- It reaches a note only through `reminderKey`: the note key wrapped under the reminder key of the
  reader. This is a personal field, as the reminder itself (on the note for its owner, on the share
  for a recipient).
- `sealNew` / `sealUpdate` send it each time a reminder is set. The route clears it when the reminder
  is cleared. `rekey` clears it for all persons.
- A note that has a reminder and no copy goes into `Sealer.feedDue`. The effect in
  `state/sharing.ts` leaves one (`leaveFeedKey`). This is the only way for a reminder that a script
  set, or a note whose key was replaced, to get its name back in the feed.

`test/sealingClient.ts` makes a token as the app does, with real keys (`test/keyedTokens.ts`),
because the server opens with them. In a test, a note written by a session has only the shape of
ciphertext. Thus, a token reads what a token wrote. `heldKeyOf` gives a recipient a real copy of the
key of a shared note.

To add a field to the words of a note, add it in all of these places:

- `noteSeal.ts` (seal, open, check; the check of a list in `noteChecks.ts`).
- `SealedNote`.
- The sealed schema.
- `SEALED_SHARED_NOTE_FIELDS`, or the personal list. `shareMapping.test.ts` fails until a person
  decided which.

The description of an image (`Note.imageAlts`) is the exception. It is sealed inside the entry of its
image in the `images` list (`ImageEntry.alt`). Thus, it has no column, and is never written apart
from the list. `sealSharedFields` refuses `imageAlts` without `images`. The `updateStoredNote` of the
client and the token codec keep the descriptions each time only `images` is written. `SealedNote`
does not have the field.

## Push

If no open app fired a reminder, the server pushes it (`jobs/pushReminders.ts`). The server cannot
read what it is about.

- `ReminderPush.sealed` contains the sealed title and excerpt of the note, and the own wrapped copy
  of the note key of the reader, exactly as the row has them.
- `title` and `body` next to them only tell that there is a reminder.
- The service worker (`swPush.ts`, `wordedPush`) opens the sealed half with the account key in
  `deviceKeys`, which exists only while the device is signed in. It words the notification as
  `reminderScheduler.ts` does.
- The worker checks each field of a push before it uses it (`readReminderPush`), because the worker
  runs with privileges.

## The server key

This is not a key of the account. It is for what the server must read when nobody is signed in
(`storage/atRest.ts`).

- The time of a reminder, the secret of a webhook, the secret of an authenticator, the VAPID key and
  the keys of each push subscription are AES-256-GCM under one key that is never in the database.
  The associated data is the purpose of the column. The id of the key is in front of each value
  (`s1.<id>.<...>`).
- `createStorage` sets the key for the process (`useAtRest`) before it builds a driver. A driver that
  you build manually, as the storage contracts do, runs unsealed.
- The row mappings and five repository methods call `atRest.seal` / `atRest.open`. A value that does
  not open reads as none (no reminder, an empty secret). It is never an error that stops a listing.
- `serverSecrets.setIfAbsent` is the only place that writes over such a value. If it answered with a
  secret that it did not store, each process and each start would sign pushes with a different key.

Seal a new column of that type where you write it, open it where you read it, and add it to
`AT_REST_COLUMNS`. `moveToCurrentKey` walks that list when the server starts. If a column is missing
from it, the server never moves it when the key is replaced, and the old key takes it away. A value
from before the server had a key still reads correctly, because the server takes all values without
the `s1.` prefix as they are. The same start-up pass seals them.

`loadServerKeys` (`storage/serverKey.ts`) takes `DATA_ENCRYPTION_KEY`, or a key file that it makes
(`0600`, `wx`). It shows a warning while the file is next to the database or its backups.
`DATA_ENCRYPTION_KEY_PREVIOUS` keeps the previous key readable until the move is complete.

## On the server

The routes for keys are in `auth/accountKeys.ts`, session-only (`openapi/keys.ts`).

- The check of the recovery key goes through `recoveryKeysOf`. It counts a wrong key against the same
  `loginAttempts` budget as a password, and audits it.
- To spend a recovery key is one conditional write (`replaceUserKeys`). Thus, two requests with the
  same key cannot both win.
- The recovery key replaced the two-factor recovery codes. An account whose only factor is passkeys
  has nothing to type at sign-in.
- A new start of an account removes its keys and, through `sharing/emptyAccount.ts`, all data sealed
  under them, also all shares of the account (`shares.listByRecipient`, because a listing does not
  include a note that its owner has in the trash). The keys go last. The emptying is many writes with
  no transaction. A request that failed halfway must be one that the client can send again. After the
  keys are gone, the client cannot (409).

The server does not upgrade a database from before encryption. Migration `0027-account-keys`, the
first step of encryption, has `refuseIf: BEFORE_ENCRYPTION`. `index.ts` prints the refusal and exits.
The guard is on the first step. Thus, a refused database does not change, and the older version still
runs on it. A later step that needs the same refusal must not come after a step that changes
something.

## Tests

The server never opens a note. Thus, its tests need only values with the shape of ciphertext:

- `ct` / `plain` in `storage/contracts/claimed.ts`.
- `test/sealingClient.ts`, which sends the requests of a test as the app does (sealed on the way out,
  opened on the way back). Thus, a route test can still use the title of a note. It uploads an image
  under an address made from its bytes, and claims the images of a note before it writes, as the app
  does.
- `rig.rawRequest` sends a body as it is, for the values that the server refuses.

On the client, the browser project installs `test/plainSealing.ts` for each test. Those tests are
about the store, the socket and the screens, with fake servers that answer with readable notes. The
node project tests the real seal (`sealing.test.ts`, `RestApiAdapter.sealed.test.ts`, against
`test/sealedServer.ts`, a server that keeps what it gets and has no key). `putImage` itself needs
`XMLHttpRequest`. Thus, the node tests seal an upload with the `Sealer`, and put it on that server
manually. The browser project also needs a real IndexedDB for `deviceKeys`.
