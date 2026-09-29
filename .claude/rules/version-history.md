---
paths:
  - "packages/client/src/state/versions.ts"
  - "packages/client/src/storage/VersionStorage.ts"
  - "packages/client/src/components/VersionHistory.tsx"
  - "packages/server/src/routes/versions*.ts"
---

# Version History

Notes have persistent version history. Versions are saved automatically when the editor closes with changes (capturing the pre-edit state), through the storage adapter (`state/versions.ts`): in connected mode the server keeps them (`note_versions`, `/api/notes/:id/versions`), and a browser's older local history for a note is sent across the first time it is opened. In open mode they are LZ-String compressed in `localStorage`, one key per note (`manifesto:versions:<id>`), so saving a version never re-compresses another note's history; the old shared `manifesto:versions` map is split on first use (`storage/VersionStorage.ts`). Capped at `MAX_NOTE_VERSIONS` per note and `NOTE_VERSION_MAX_AGE_DAYS` in both. UI: `components/VersionHistory.tsx`, accessed via kebab menu in the note editor.
