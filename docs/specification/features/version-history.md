# Version History

Notes have persistent version history, allowing users to browse and restore previous versions.

## Behavior

- When the note editor closes with unsaved changes, the pre-edit state is automatically saved as a version
- Version history is accessible from the kebab menu in the note editor
- Each version shows the timestamp when it was captured
- Selecting a version restores its title and content to the note
- Versions are per-note and stored locally

## Storage

- Versions are stored in `localStorage` under the key `manifesto:versions`
- Data is compressed using LZ-String to minimize storage usage
- Capped at 50 versions per note
- Versions older than 90 days are automatically pruned

## Data Model

Each version is a `NoteVersion` (see [Data Model](../data-model.md)) containing:

- `noteId` — the note this version belongs to
- `timestamp` — when the version was captured
- `title` — the note title at that point
- `content` — the note content at that point

## Limitations

- Version history is local-only — not synced to the server
- Only title and content are versioned (not color, font, tags, etc.)
- Version history is not included in share links or export files
