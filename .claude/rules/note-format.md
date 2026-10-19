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

The specification is "Format" in `docs/specification/data-model.md`. A number,
`currentNoteFormat()`, tells what the words of a note contain. The number is the count of steps in
`NOTE_FORMAT_STEPS` (`shared/src/noteFormat.ts`), plus one. The app keeps all notes in the current
format. Each place that keeps a note records the format of the note. Code that reads a note from
that place runs `upgradeNoteWords` before other code gets the note.

**To change what the words contain, append a step to `NOTE_FORMAT_STEPS`.** Never edit a step that
is already released, because a stored note records the steps that it has had. A step gets the words
that the holder has (a version has only a title and text). It changes those words and adds no
words. That is the full format change: all of the readers below already run the steps, and all of
the writers record the new number. The change does not apply to the shared document in which a
note is edited, which has `EDITOR_SCHEMA_VERSION`. It also does not apply to color and tags. The
checks in `noteChecks.ts` control those when a note opens.

These are the places, and what each place does with a format that it does not know:

- **Open mode**: `manifesto:notes:format` in `LocalStorageAdapter.ts`. It applies to the notes and
  to the versions of `VersionStorage` together. `loadNotes` upgrades the full store one time:
  versions first, then the notes. The write of the notes records the format. `readableFormat`
  refuses a newer store on each read and write, before the parse cache. Thus, an old tab does not
  read the store incorrectly, and does not write over it.
- **Connected mode**: `format` on `SealedNote`, `SealedNoteVersion` and `PublicSnapshot`. It is not
  sealed.
  - The shared seal functions record it: `sealNewNote`, `sealNoteUpdate` (when the changes include
    words), and `sealVersion`.
  - `openSealedNote` and `openVersion` upgrade, or return null for a newer format. The `Sealer` puts
    those notes in `newer`, not in `unreadable`.
  - The server checks each write against the stored format inside the `UPDATE`
    (`formatCondition`). It refuses words older than those of the note. It accepts words in a newer
    format only when the write contains all of the words, because the format is one number for all
    words.
  - Thus, a write that moves a note to a new format sends all of the words.
    `Sealer.inCurrentFormat`, and `sealedChanges` on the token path, read the note, upgrade it, and
    add the other words with `withEveryWord`.
- **An export**: `manifest.json` (`exportArchiveFiles`). `notesFromZip` upgrades an older archive.
  For a newer archive, it throws `NewerNoteFormatError`, and `importFiles` counts it in
  `newerCount`.
- **Notes that are not stored yet**: each IndexedDB record in `offlineNotes.ts` has `format`.
  `readOffline` does not change a newer record. It gives the format to `composerDraft.ts` and
  `unsentNotes.ts`, which upgrade what they read.

If you add a new place that keeps the words of a note, record the format with the words, and run the
steps when you read them. If you do not, the app reads a note from before a format change as if it
were in the current format.

`NewerNoteFormatError` from any of these places goes to the user through `reportFailure`. The
message tells the user to reload, in place of the usual message of the action. Tests make the
format higher with `setNoteFormatStepsForTests`, and make it lower again to simulate an older build.
`noteFormatContract.ts` runs the server check against both drivers.
