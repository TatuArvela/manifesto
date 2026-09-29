---
paths:
  - "packages/client/src/utils/shareLink.ts"
  - "packages/client/src/utils/importers/**"
  - "packages/client/src/utils/importExport.ts"
  - "packages/client/src/utils/importedNote.ts"
  - "packages/client/src/utils/noteDownload.ts"
  - "packages/client/src/utils/zip.ts"
  - "packages/client/src/state/exportNotes.ts"
  - "packages/client/src/state/accountExport.ts"
  - "packages/client/src/state/publicLinks.ts"
  - "packages/client/src/components/SharedNoteDialog.tsx"
  - "packages/client/src/components/PublicNotePage.tsx"
  - "packages/server/src/routes/publicLinks.ts"
  - "packages/server/src/export/**"
  - "packages/shared/src/exportArchive.ts"
---

# Sharing, Import and Export

`utils/shareLink.ts` encodes a note into the URL fragment (LZ-String over a five-field JSON payload),
so a share link needs no server and no account. The fragment is attacker-controlled, so
`decodeSharePayload` is a total type guard, not a cast: every field is checked, color and font
against the enums, and anything that fails returns `null` rather than a partly-trusted note. `App`
shows `SharedNoteDialog` when the fragment is present, and the recipient chooses whether to save.
The rendered preview still goes through `remarkRenderer`, which sanitizes.

Public links (`routes/publicLinks.ts`, `state/publicLinks.ts`) are the revocable, server-side
counterpart: `/p/<token>` renders `PublicNotePage` in place of the app (`main.tsx`), with no account.
Every way a link fails answers the same 404, and a view is counted by one conditional `UPDATE`
(`recordView`), never a read then a write. A snapshot's pictures are referrers for the attachment
sweep in both drivers, so a new place that keeps attachment references must be added there too.

Other apps' formats (Evernote, Joplin, Simplenote, Standard Notes, HTML) are `Importer`s in
`utils/importers/`, registered in its `index.ts`; `importFiles` offers each file and each archived
JSON document to them, so a new format is one file there.

`utils/importExport.ts` reads files in, for Markdown and JSON, single note and bulk; `utils/importedNote.ts`
turns their contents into notes, and `utils/noteDownload.ts` saves one note out. It
caps input at 50MB, because a multi-GB drop locks the tab inside `JSON.parse` before any of our
code runs. The full export is a zip in both modes, laid out by `exportArchiveFiles` in
`@manifesto/shared` so the server's download and open mode's `exportArchive` stay the same archive;
importing one files its `versions.json` through `restoreVersions`. Export is one of the three callers that genuinely needs image bytes rather than
`imageCount`; see `pagination.md`.
