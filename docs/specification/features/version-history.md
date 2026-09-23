# Version History

Notes have persistent version history, allowing users to browse and restore previous versions.

## Behavior

- When the note editor closes with unsaved changes, the pre-edit state is automatically saved as a version
- Version history is accessible from the kebab menu in the note editor
- Each version shows the timestamp when it was captured
- Selecting a version restores its title and content to the note
- Versions are per-note. In open mode they are kept in this browser; in connected mode on the server,
  so every device and everyone holding the note sees one history

## Storage

Both modes keep at most `MAX_NOTE_VERSIONS` (50) per note and none older than
`NOTE_VERSION_MAX_AGE_DAYS` (90), constants in `@manifesto/shared`. The client saves and reads through
the storage adapter (`state/versions.ts`), so the editor does not know which mode it is in.

### Connected mode

- `note_versions` in either driver, pruned per note as versions are added, and deleted with the note.
- `GET /api/notes/:id/versions` lists them newest first to anyone who can read the note;
  `POST /api/notes/:id/versions` (`{ title, content, timestamp? }`) adds one, for the owner and editors
  only. A viewer's editor never has changes to save, so it never asks.
- `timestamp` is for history brought across from a browser and is kept only when it is a real moment in
  the past and inside the 90 days; otherwise the server stamps the time it received it.
- A browser that kept a note's history locally before sends it across, oldest first with its own
  dates, the first time the note's history is opened there, and then drops its copy.
- A version holds title and content only, so attachments are referred to, not copied: the attachment
  sweep keeps an unreferenced image for 90 days for this reason (see [Attachments](attachments.md)).

### Open mode

- Versions are stored in `localStorage`, one key per note: `manifesto:versions:<noteId>`. Saving a
  version rewrites only that note's history. Histories written under the single shared
  `manifesto:versions` key by older versions are split into per-note keys on first use.
- Data is compressed using LZ-String to minimize storage usage
- Capped at 50 versions per note
- Versions older than 90 days are automatically pruned

## Data Model

Each version is a `NoteVersion` (see [Data Model](../data-model.md)) containing:

- `noteId`: the note this version belongs to
- `timestamp`: when the version was captured
- `title`: the note title at that point
- `content`: the note content at that point

## Limitations

- In open mode, version history lives in one browser and is lost with its site data
- Only title and content are versioned (not color, font, tags, etc.)
- Version history is not included in share links or export files
