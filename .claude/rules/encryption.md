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
  - "packages/client/src/storage/RestApiAdapter.ts"
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
  no longer count inside a field.
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

A field added to a note's words is added in `noteSeal.ts` (seal, open, check), `SealedNote`, the
sealed schema and `SEALED_SHARED_NOTE_FIELDS` or the personal list, and `shareMapping.test.ts`
fails until someone has decided which.

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
title. `rig.rawRequest` sends a body as given, for what the server refuses.

On the client, the browser project installs `test/plainSealing.ts` for every test: those tests are
about the store, the socket and the screens, with fake servers that answer readable notes. Real
sealing is tested in the node project (`sealing.test.ts`, `RestApiAdapter.sealed.test.ts`, against
`test/sealedServer.ts`, a server that holds what it is sent and no key). The browser project also
needs a real IndexedDB for `deviceKeys`.
