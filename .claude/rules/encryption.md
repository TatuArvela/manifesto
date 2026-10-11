---
paths:
  - "packages/shared/src/api/keys.ts"
  - "packages/client/src/utils/seal.ts"
  - "packages/client/src/utils/userKey.ts"
  - "packages/client/src/utils/keyMaterial.ts"
  - "packages/client/src/storage/deviceKeys.ts"
  - "packages/client/src/state/accountKeys.ts"
  - "packages/client/src/components/KeyScreen.tsx"
  - "packages/client/src/components/KeySheet.tsx"
  - "packages/client/src/components/RecoveryForms.tsx"
  - "packages/client/src/components/settings/KeysSettings.tsx"
  - "packages/server/src/auth/accountKeys.ts"
  - "packages/server/src/openapi/keys.ts"
  - "packages/server/src/storage/accountKeysMapping.ts"
  - "packages/server/src/storage/*/accountKeysRepo.ts"
  - "packages/server/src/storage/contracts/accountKeysContract.ts"
  - "docs/specification/features/encryption.md"
---

# Encryption

The design is `docs/specification/features/encryption.md`: end to end, for every account in
connected mode, built in the order its last section gives. Step 1 (keys and unlocking) is built;
nothing is encrypted with the keys yet. That page's "Order of building" says where the code is
narrower than the design until the later steps land, and has to be kept true as they do.

Signing in opens nothing. `keyState` (`state/accountKeys.ts`) is what `App` shows the board on:
`setup` for an account with no keys (the browser makes them and shows the sheet once), `locked` until
the secret key is entered, `unlocked` after. It follows the session through one effect, so a
sign-out and a session the server ended both remove the keys with no caller having to remember; a
new way in only has to set `authToken`. A flow that already holds the keys when it signs in (the
recovery key from the sign-in screen) sets them before `adoptSession`, so the check that follows
finds the account unlocked instead of asking for a key.

What never happens, and what each is guarded by:

- **The account key is never readable.** `utils/keyMaterial.ts` hands it out wrapped (for the server)
  or as a `CryptoKey` that derives and cannot be exported (for the device). Its raw bytes live inside
  one function and are overwritten in a `finally`. Re-wrapping therefore opens the server's copy with
  the secret key the device holds (`withAccountKey`); do not make the key extractable to save that.
- **The server never sees a key a person holds.** The secret key and the recovery key
  (`utils/userKey.ts`) are random, about 138 bits, which is why a plain HKDF is enough and no
  passphrase may ever stand in for one. The recovery key proves itself with a verifier derived apart
  from the key that wraps, and the server keeps the verifier's SHA-256.
- **A ciphertext does not open anywhere else.** Everything goes through `seal` / `unseal`
  (`utils/seal.ts`): AES-256-GCM, a random nonce a value, and `associatedData` naming the row, the
  field, the key version and the account. `unseal` answers null for every failure and never throws.
  A key for each job comes from `accountSubkey`; a new job is a new purpose, never a reused key.
- **The server stores only what is shaped as a ciphertext** where one belongs (`isCiphertext` in
  shared, `wrappedKey` in `validation/schemas.ts`), since the shape is all it can check.
- **A device holds keys only while signed in.** `storage/deviceKeys.ts` keeps them in IndexedDB
  with the day the session ends at the latest (`sessionEndsAt` from `GET /api/auth/keys`), and
  `checkAccountKeys` removes a copy that is another account's or past that day.

Every key is shown once, on a sheet (`KeepSheetStep`), and the write that makes it real comes after
the user says they kept it: set-up and both recoveries prepare first and complete second. Keep that
order for any new flow that makes a key someone has to hold.

On the server the routes are `auth/accountKeys.ts`, session-only (`openapi/keys.ts`): a token is
handed the keys it needs when it is made (step 6), never these. What checks the recovery key goes
through `recoveryKeysOf`, which counts a wrong one against the same `loginAttempts` budget as a
password and audits it. Spending a recovery key is one conditional write (`replaceUserKeys`), so two
requests holding the same key cannot both win. The recovery key took the place of the two-factor
recovery codes: an account whose only factor is passkeys has nothing to type at sign-in.

The browser test project needs a real IndexedDB for `deviceKeys`; the node project runs everything
else here, with WebCrypto from Node and the device store answering as a browser that refuses it.
