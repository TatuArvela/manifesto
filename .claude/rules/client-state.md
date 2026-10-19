---
paths:
  - "packages/client/src/state/**"
  - "packages/client/src/storage/**"
  - "packages/client/src/components/NoteInput.tsx"
  - "packages/client/src/hooks/useComposerFields.ts"
  - "packages/client/src/components/UnsentNotes.tsx"
---

# Client State Management

The state is in `packages/client/src/state/`, and uses @preact/signals.

## notesStore.ts

**`notesStore.ts`** contains the `notes` signal, and the actions that send it to the storage
(`createNote`, `updateNote`, `deleteNote`, `loadNotes`, `importNotes`, `ensureImages`).

- `actions.ts` builds the user-level actions on it (trash, archive, pin, tags, bulk, reorder).
- `views.ts` contains the computed views (`filteredNotes`, `sortedNotes`, `allTags`).
- `selection.ts`, `ordering.ts` and `exportNotes.ts` contain the other parts.

### Actions never reject

**An action reports its own failure and resolves. It never rejects.** Its return value tells if it
worked (`false`, or `null` where a value was expected). The callers are JSX handlers, which have no
place for a `catch`. A rejection there is an unhandled rejection, and the user never sees it.

Group work goes through `asBatch` (`failures.ts`). It gives each action a `Batch`. The action counts
its failure in the batch, and does not show its own toast. The batch reports the total one time.
Always give the batch explicitly. Never keep it in module state, because two groups can run at the
same time.

### Writes in connected mode

In connected mode, a write is local-first: `updateNote` puts the change in the signal before it
sends it.

- Each copy of a note that the server sends (a reply, a broadcast, a listing) comes in through
  `receiveNote` or `receiveNoteList`. It never comes in through a plain assignment. A note goes out
  through `forgetNote`.
- `pendingWrites.ts` applies the writes that are not complete on top of that copy again. Thus, a
  late reply cannot revert a newer click.
- If a copy is older (by `updatedAt`) than the last copy that came in, the last copy replaces it.
  The reason is that the body of a 412, or a slow reply, can arrive after a newer broadcast.
- A failed write goes back to that last confirmed copy. It never goes back to the note as it was at
  the click.
- `pendingWrites.property.browser.test.ts` runs all of this against a fake `If-Match` server, with
  generated interleavings. Run it after you change any of these parts.
- `settle` must get the same `changes` object as `begin`, also when a conflict retry sent a merged
  object.
- When nothing changed, `incomingNote.ts` gives back the held note by reference. A client hears its
  own write two times (as the reply and as the broadcast). A reconnect also gets the notes again.
  The reference prevents a new paint of the board, and prevents the loss of image bytes that a card
  already loaded.
- Grouped writes start together. Each one shows its change before it awaits anything.

## composerDraft.ts and unsentNotes.ts

**`composerDraft.ts`** and **`unsentNotes.ts`** keep the text of the new-note composer on the device
before the app stores it (`storage/offlineNotes.ts`, plain IndexedDB). In connected mode, the data
is sealed under the `drafts` subkey.

- `NoteInput` saves its draft after a debounce and on `pagehide`. It reads the draft back when it
  opens. It clears the draft when it closes or when you discard it.
- It writes nothing until that read is complete (`draftRead`). If not, the empty editor clears the
  draft that it must show.
- It builds the editor again around a restored draft, because Milkdown accepts its text only when it
  is built.

When the composer closes, it calls `queueNote`, never `createNote`. In connected mode, the note gets
its id there, and the app keeps it before it sends it. `sendUnsent` sends it again until it arrives
(on the `online` event, a socket reconnect, an unlock).

- If a send failed because there was no server, the note waits.
- A 409 means that the note is possibly this one, and its answer was lost. Thus, the app first looks
  for it by id.
- All other refusals mark it `refused`. The app does not send it again until it changes.

A note in the queue is not in `notes`. Thus, it is not on the board. `UnsentNotes` lists the notes
whose first try failed (`settledNoteIds`). Thus, a note that arrives immediately does not show for a
moment. A kept note contains the keys of its images, which the `Sealer` keeps only in memory.

When you sign out, the app deletes both. If the queue is not empty, it asks first. A 401 keeps
them, sealed, for the next unlock. Browser test files share one IndexedDB. Thus, each test file keeps
the records of open mode under its own name (`setOpenModeOwnerForTests`). A test that renders the
composer clears the draft before and after it.

## ui.ts

**`ui.ts`** contains the UI state signals (`editingNoteId`, `activeView`, `searchQuery`,
`selectedNotes`).

## prefs.ts

**`prefs.ts`** keeps the user preferences in the `localStorage` key `manifesto:prefs`, with a
debounced `effect()`.

- `prefParsers.ts` tells what each preference can contain, and how the app reads a stored value
  back (`PREF_PARSERS`, `DEVICE_PREFS`).
- In connected mode, `prefsSync.ts` also keeps each preference that is not in `DEVICE_PREFS` on the
  server (`/api/v1/auth/me/prefs`, `prefs:updated`). Thus, a new preference goes with the account,
  unless you add it to `DEVICE_PREFS`.
- All data from the server goes through `PREF_PARSERS`, the same as a blob that a person edited.
  `adoptAccountPrefs` saves it itself, because the save effect ignores a change from a different
  source.
- While a user is signed in, the app takes only the device preferences from the blob of a different
  tab (the `storage` event, `setAccountPrefsFromServer`). Each tab gets the account preferences on
  its own socket. A tab saves each time it adopts the copy of the server. When the app took the full
  blob, a late echo in one tab put back a value that was just changed in a different tab.
- `serverDefaults.ts` contains the defaults of the host (`DEFAULT_PREFS`, `defaultPrefs` in
  `/api/v1/capabilities`). This module has no side effects, and imports no state. Thus, `auth.ts`
  and `prefsSync.ts` can both set it, and neither loads the other or `prefs.ts`.
- At sign-in, `prefsSync.ts` gives a default to each key that the account does not have. If the
  answer of `/api/v1/capabilities` is not available yet, it asks for it. On a first visit,
  `prefs.ts` applies all of the defaults.

## router.ts

**`router.ts`** keeps `activeView` / `activeTag` and `location.pathname` the same, in both
directions (see `routing.md`). `App` calls `initRouter()` one time when it mounts (`useAppServices`).
The URL *fragment* is a different channel. Share links and the OIDC callback use it. The router
does not.

## account/auth.ts

**`account/auth.ts`** is the authentication for server mode.

- The `authToken` and `currentUser` signals are kept in the `localStorage` key `manifesto:auth`.
- `login` and `register` send a POST to `/api/v1/auth/*`.
- When `LoginScreen` mounts, it reads `/api/v1/capabilities` (`fetchCapabilities`, which also fills
  `serverFeatures`). Then it shows the local form or one "Continue with SSO" button (a link to
  `${SERVER_URL}/api/v1/auth/login`), as the active provider requires.
- Requests without a session go out through `requestWithoutSession` in this file. `mailedLinks.ts`
  (the reset links and the sign-in links) and `oidcSignIn.ts` use it, so that they do not need their
  own `fetch`.

After an OIDC callback, the server redirects to the client with `#token=...`.
`consumeOidcRedirect()` (`oidcSignIn.ts`) runs one time when `App` mounts. It gets
`/api/v1/auth/me`, fills the signals, and removes the fragment from the URL.

It accepts the token only where `takeOidcFlow()` (`oidcFlow.ts`) finds the mark that this tab left
when it went out. Thus, each link to `oidcLoginUrl` or `oidcReauthUrl` has
`onClick={beginOidcSignIn}` (and `onAuxClick`). If a new link does not have it, the app ignores the
return of its sign-in. If the app accepted each `#token=` that it sees, a link with a token signs its
reader in to the account of the sender.
