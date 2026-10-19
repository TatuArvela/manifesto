---
paths:
  - "packages/shared/src/noteFormat.ts"
  - "packages/shared/src/exportArchive.ts"
  - "packages/client/src/storage/LocalStorageAdapter.ts"
  - "packages/client/src/storage/offlineNotes.ts"
  - "packages/client/src/utils/importExport.ts"
  - "packages/server/src/storage/noteMapping.ts"
  - "packages/server/src/storage/contracts/noteFormatContract.ts"
---

# A Note's Format

Spec: "Format" in `docs/specification/data-model.md`. What a note's words hold is a number,
`currentNoteFormat()`, which is one more than the steps in `NOTE_FORMAT_STEPS`
(`shared/src/noteFormat.ts`). The app holds every note in the current format; each place a note is
kept records the format it was written in, and whatever reads one from there runs
`upgradeNoteWords` before anything else sees it.

**Changing what the words hold is a step appended to `NOTE_FORMAT_STEPS`**, never an edit to a step
already released, since a stored note remembers which steps it has had. A step gets whichever words
the holder has (a version has a title and text alone), changes those, and adds none. That is the
whole of a format change: every reader below already runs the steps, and every writer stamps the
new number. It does not reach the shared document a note is edited in, which has
`EDITOR_SCHEMA_VERSION`, or colour and tags, which the checks in `noteChecks.ts` hold on opening.

The places, and what each does with a format it does not know yet:

- **Open mode**: `manifesto:notes:format` in `LocalStorageAdapter.ts`, for the notes and
  `VersionStorage`'s versions together. `loadNotes` upgrades the whole store once (versions first,
  then the notes, whose write stamps the format), and `readableFormat` refuses a newer store on
  every read and write, before the parse cache, so an old tab neither misreads nor overwrites it.
- **Connected mode**: `format` on `SealedNote`, `SealedNoteVersion` and `PublicSnapshot`, readable.
  The shared seal functions stamp it (`sealNewNote`, `sealNoteUpdate` when words are among the
  changes, `sealVersion`) and `openSealedNote` / `openVersion` upgrade, or answer null for a newer
  one; the `Sealer` sorts those into `newer` rather than `unreadable`. The server holds each write
  to the stored format inside the `UPDATE` (`formatCondition`): words older than the note's are
  refused, and words in a newer one only with all of them, because the format is one number for
  every word. So a write that moves a note on sends every word: `Sealer.inCurrentFormat` and the
  token path's `sealedChanges` read the note, upgrade it, and fill in the rest with `withEveryWord`.
- **An export**: `manifest.json` (`exportArchiveFiles`); `notesFromZip` upgrades an older archive
  and throws `NewerNoteFormatError` for a newer one, which `importFiles` counts in `newerCount`.
- **Notes not stored yet**: each IndexedDB record in `offlineNotes.ts` carries `format`;
  `readOffline` leaves a newer one in place and hands the format to `composerDraft.ts` and
  `unsentNotes.ts`, which upgrade what they read.

A new place that keeps a note's words records the format beside them and runs the steps when it
reads, or a note kept there before a format change is read as if it were current.
`NewerNoteFormatError` from any of them reaches the user through `reportFailure`, which says to
reload instead of the action's own message. Tests raise the format with
`setNoteFormatStepsForTests` and lower it again to play an older build; `noteFormatContract.ts`
runs the server's guard against both drivers.
