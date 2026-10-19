---
paths:
  - "packages/client/src/state/versions.ts"
  - "packages/client/src/storage/VersionStorage.ts"
  - "packages/client/src/components/VersionHistory.tsx"
  - "packages/server/src/routes/versions*.ts"
---

# Version History

Notes have a persistent version history. The app saves a version automatically when the editor
closes with changes. The version holds the state from before the edit. The save goes through the
storage adapter (`state/versions.ts`).

- **Connected mode**: the server keeps the versions (`note_versions`,
  `/api/v1/notes/:id/versions`). The first time a note opens, the browser sends its older local
  history for that note to the server.
- **Open mode**: the versions are in `localStorage`, compressed with LZ-String. Each note has its
  own key (`manifesto:versions:<id>`). Thus, a new version of one note does not compress the history
  of other notes again. The first use splits the old shared `manifesto:versions` map
  (`storage/VersionStorage.ts`).

Both modes keep a maximum of `MAX_NOTE_VERSIONS` for each note, and no version older than
`NOTE_VERSION_MAX_AGE_DAYS`. The UI is `components/VersionHistory.tsx`. Open it from the kebab menu
in the note editor.
