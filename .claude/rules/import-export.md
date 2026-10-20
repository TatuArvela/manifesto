---
paths:
  - "packages/client/src/utils/shareLink.ts"
  - "packages/client/src/utils/importers/**"
  - "packages/client/src/utils/importExport.ts"
  - "packages/client/src/utils/importedNote.ts"
  - "packages/client/src/utils/noteDownload.ts"
  - "packages/client/src/utils/zip.ts"
  - "packages/client/src/state/exportNotes.ts"
  - "packages/client/src/state/account/accountExport.ts"
  - "packages/client/src/state/publicLinks.ts"
  - "packages/client/src/components/sharing/SharedNoteDialog.tsx"
  - "packages/client/src/components/PublicNotePage.tsx"
  - "packages/server/src/routes/publicLinks.ts"
  - "packages/server/src/export/**"
  - "packages/shared/src/exportArchive.ts"
---

# Sharing, Import and Export

## Share links

`utils/shareLink.ts` encodes a note into the URL fragment (LZ-String over a JSON payload with five
fields). Thus, a share link needs no server and no account. An attacker can control the fragment.
Thus, `decodeSharePayload` is a total type guard, not a cast:

- It checks each field. It checks the color and the font against the enums.
- If a check fails, it returns `null`. It does not return a note that is partly trusted.

When the fragment is present, `App` shows `SharedNoteDialog`. The recipient decides to save the note
or not. The preview still goes through `remarkRenderer`, which sanitizes it.

## Public links

Public links (`routes/publicLinks.ts`, `state/publicLinks.ts`) are the server-side equivalent, and
you can revoke them. `/p/<token>` shows `PublicNotePage` in place of the app (`main.tsx`). It needs
no account.

- All of the failures of a link give the same 404.
- One conditional `UPDATE` (`recordView`) counts a view. The code never reads and then writes.
- The password checks of a link run one at a time (`inTurn`), for the same reason. The code reads
  the failure count before a verification, and the verification takes a long time. During that
  time, other requests can arrive.
- In both drivers, the pictures of a snapshot are referrers for the attachment sweep. If you add a
  new place that keeps attachment references, add it to the sweep too.

## Importers

The formats of other apps (Evernote, Joplin, Simplenote, Standard Notes, HTML) are `Importer`s in
`utils/importers/`. Its `index.ts` registers them. `importFiles` gives each file, and each JSON
document in an archive, to the importers. Thus, to add a format, add one file there.

## Import and export of files

- `utils/importExport.ts` reads files: Markdown and JSON, one note or many.
- `utils/importedNote.ts` changes their contents into notes.
- `utils/noteDownload.ts` saves one note to a file.

The input limit is 50MB. The reason is that a drop of many GB stops the tab inside `JSON.parse`,
before our code can run.

In both modes, the full export is a zip. `exportArchiveFiles` in `@manifesto/shared` sets the
layout. Thus, the download from the server and the `exportArchive` of open mode make the same
archive. An import of an archive restores its `versions.json` through `restoreVersions`.

In connected mode, the archive contains the notes that the account owns (`sharing.role`). It never
contains a note that a different account shared with it. The export stops if one of the notes of the
account did not open on this device (`Sealer.missesOwnNotes`). Export is one of the three callers
that must have the image bytes, not only `imageCount`. See `pagination.md`.
