---
paths:
  - "packages/client/src/state/**"
  - "packages/client/src/storage/**"
  - "packages/client/src/components/NoteInput.tsx"
  - "packages/client/src/hooks/useComposerFields.ts"
  - "packages/client/src/components/UnsentNotes.tsx"
---

# Client State Management

State lives in `packages/client/src/state/` using @preact/signals:

- **`notesStore.ts`**: the `notes` signal and the actions that talk to storage about it
  (`createNote`, `updateNote`, `deleteNote`, `loadNotes`, `importNotes`, `ensureImages`).
  `actions.ts` builds the user-level actions on it (trash, archive, pin, tags, bulk, reorder),
  `views.ts` holds the computed views (`filteredNotes`, `sortedNotes`, `allTags`), and
  `selection.ts`, `ordering.ts` and `exportNotes.ts` the rest.
  **An action reports its own failure and resolves; it never rejects**, and says whether it worked
  in its return value (`false`, or `null` where a value was expected). The call sites are JSX
  handlers with nowhere to put a `catch`, so a rejection there is an unhandled rejection the user
  never sees. Group work goes through `asBatch` (`failures.ts`), which hands each action a `Batch`
  to count its failure in instead of raising its own toast, and reports the total once. The batch
  is passed explicitly, never held in module state, since two groups can be in flight at once.
  In connected mode a write is local-first: `updateNote` puts the change in the signal before it
  sends. Every copy of a note the server sends back (a reply, a broadcast, a listing) comes in
  through `receiveNote` / `receiveNoteList` and never through a plain assignment; a note leaves
  through `forgetNote`.
  `pendingWrites.ts` replays the writes still outstanding on top of that copy, so a late reply
  cannot revert a newer click. A copy older (by `updatedAt`) than the last one taken in is replaced
  by that one, since a 412's body or a slow reply can arrive after a newer broadcast, and a failed
  write falls back to that last confirmed copy, never to the note as it was clicked.
  `pendingWrites.property.browser.test.ts` drives all of this against a fake `If-Match` server over
  generated interleavings; run it after touching any of them. `settle` must get the same `changes` object `begin` did, even
  when a conflict retry sent a merged one. `incomingNote.ts` hands back the held note by
  reference when nothing changed. That keeps a client's own write, which it hears twice (as the
  reply and as the broadcast), and a reconnect's re-fetch from repainting the board or dropping
  image bytes a card already loaded. Grouped writes start together, each showing its change
  before it awaits anything.
- **`composerDraft.ts`** and **`unsentNotes.ts`**: what is written in the new-note composer before
  it is stored, kept on the device (`storage/offlineNotes.ts`, plain IndexedDB, sealed in connected
  mode under the `drafts` subkey). `NoteInput` saves its draft on a debounce and on `pagehide`,
  reads it back when it opens and clears it on close or discard; it writes nothing until that read
  has come back (`draftRead`), or the empty editor clears the draft it is about to show, and it
  rebuilds the editor around a restored draft, since Milkdown takes its text only when built. Closing
  the composer calls `queueNote`, never `createNote`: in connected mode the note gets its id there,
  is kept before it is sent, and is sent again by `sendUnsent` (the `online` event, a socket
  reconnect, an unlock) until it lands. A send that failed for want of a server waits; a 409 means
  the note may be this one whose answer was lost, so it is looked up by id before anything else;
  any other refusal marks it `refused`, never sent again until it is changed. A note in the queue is
  not in `notes` and so not on the board: `UnsentNotes` lists the ones whose first try has failed
  (`settledNoteIds`), so a note that lands at once never flashes up. A kept note carries the keys of
  its images, which the `Sealer` holds only in memory. Signing out deletes both, after asking when
  the queue is not empty; a 401 keeps them, sealed, for the next unlock. Browser test files share
  one IndexedDB, so each keeps open mode's records under a name of its own
  (`setOpenModeOwnerForTests`), and a test that renders the composer clears the draft around itself.
- **`ui.ts`**: UI state signals (`editingNoteId`, `activeView`, `searchQuery`, `selectedNotes`).
- **`prefs.ts`**: User preferences persisted to `localStorage` key `manifesto:prefs` with debounced `effect()`.
  What each may hold and how a stored value is read back (`PREF_PARSERS`, `DEVICE_PREFS`) is `prefParsers.ts`.
  In connected mode `prefsSync.ts` also keeps every preference outside `DEVICE_PREFS` on the server
  (`/api/auth/me/prefs`, `prefs:updated`), so a new preference follows the account unless it is
  added there. Whatever arrives from the server goes through `PREF_PARSERS` like a hand-edited blob,
  and `adoptAccountPrefs` saves it itself, since the save effect skips a change from elsewhere.
  The host's defaults (`DEFAULT_PREFS`, `defaultPrefs` in `/api/capabilities`) are held in
  `serverDefaults.ts`, a module with no side effects and no imports of state, so `auth.ts` and
  `prefsSync.ts` both set it without loading each other or `prefs.ts`. `prefsSync.ts` gives one
  to each key the account lacks at sign-in (asking `/api/capabilities` itself if the answer has
  not arrived), and `prefs.ts` applies them all on a first visit.
- **`router.ts`**: Two-way sync between `activeView`/`activeTag` and `location.pathname` (see
  `routing.md`). `initRouter()` is called once from `App` on mount. The URL *fragment* is a
  separate channel used by share links and the OIDC callback, not by the router.
- **`auth.ts`**: Server-mode auth: `authToken` / `currentUser` signals persisted to `localStorage` key `manifesto:auth`. `login` / `register` POST to `/api/auth/*`. `LoginScreen` reads `/api/capabilities` (`fetchCapabilities`, which also fills `serverFeatures`) on mount and renders either the local form or a single "Continue with SSO" button (linking to `${SERVER_URL}/api/auth/login`) depending on the active provider. After an OIDC callback the server redirects to the client with `#token=...`; `consumeOidcRedirect()` runs once on `App` mount, fetches `/api/auth/me`, populates the signals, and strips the fragment from the URL. It takes the token only where `takeOidcFlow()` (`oidcFlow.ts`) finds the mark this tab left on its way out, so every link to `oidcLoginUrl` / `oidcReauthUrl` carries `onClick={beginOidcSignIn}` (and `onAuxClick`); a new one without it starts a sign-in whose return is ignored. Taken on sight, a `#token=` in a link would sign its reader in to the sender's account.
