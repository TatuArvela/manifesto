# Version History

Notes have a persistent version history. Users can see previous versions and restore them.

## Behavior

- When the note editor closes with unsaved changes, the app saves the state from before the edit as
  a version.
- To see the version history, open the kebab menu in the note editor.
- Each version shows the time when the app recorded it.
- When you select a version, the app restores its title and content to the note.
- Each note has its own versions. In open mode, this browser keeps them. In connected mode, the
  server keeps them. Thus, all devices, and all persons who have the note, see the same history.

## Storage

Both modes keep a maximum of `MAX_NOTE_VERSIONS` (50) for each note, and no version older than
`NOTE_VERSION_MAX_AGE_DAYS` (90). These constants are in `@manifesto/shared`. The client saves and
reads through the storage adapter (`state/versions.ts`). Thus, the editor does not know the mode.

### Connected mode

- Both drivers use `note_versions`. When the server adds a version, it prunes the versions of that
  note. When the note is deleted, its versions are deleted too.
- `GET /api/v1/notes/:id/versions` lists the versions, newest first. All persons who can read the
  note can use it.
- `POST /api/v1/notes/:id/versions` (`{ title, content, timestamp? }`) adds a version. Only the
  owner and the editors can use it. The editor of a viewer never has changes to save, so it never
  sends this request.
- `timestamp` is for history that comes from a browser. The server keeps it only if it is a real
  time in the past and inside the 90 days. If not, the server records the time when it received the
  version.
- Some browsers kept the history of a note locally before. The first time the history of the note
  opens in such a browser, the browser sends the history to the server, oldest first, with the
  original dates. Then the browser deletes its copy.
- A version contains only the title and the content. Thus, it refers to attachments, but does not
  copy them. For this reason, the attachment sweep keeps an unreferenced image for 90 days (see
  [Attachments](attachments.md)).

### Open mode

- The versions are in `localStorage`, with one key for each note: `manifesto:versions:<noteId>`.
  When the app saves a version, it writes only the history of that note again. Older releases kept
  all histories under one shared `manifesto:versions` key. On the first use, the app splits these
  histories into one key for each note.
- LZ-String compresses the data, to use less storage.
- The maximum is 50 versions for each note.
- The app automatically prunes versions that are older than 90 days.

## Data Model

Each version is a `NoteVersion` (see [Data Model](../data-model.md)). It contains:

- `noteId`: the note of this version
- `timestamp`: the time when the app recorded the version
- `title`: the title of the note at that time
- `content`: the content of the note at that time

## Limitations

- In open mode, the version history is in one browser. If you clear the site data of that browser,
  the history is lost.
- Only the title and the content have versions. Color, font, tags and other fields do not.
- Share links and export files do not contain the version history.
