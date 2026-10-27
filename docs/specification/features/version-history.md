# Version History

Notes have a persistent version history. Users can see previous versions and restore them.

## Behavior

- When the note editor closes after a change to the title, the text or the images, the app saves the
  state from before the edit as a version. The images are those that the note had when the editor
  opened, with their descriptions. A replaced drawing is such a change.
- To see the version history, open the kebab menu in the note editor.
- Each version shows the time when the app recorded it.
- The view of one version shows its title, its content and a row of its images.
- When you select a version, the app restores its title, its content and its images to the note. A
  version from before images were kept restores only its title and content.
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
- `POST /api/v1/notes/:id/versions` (`{ title, content, images?, imageRefs?, timestamp? }`) adds a
  version. Only the owner and the editors can use it. The editor of a viewer never has changes to save, so it never
  sends this request.
- `timestamp` is for history that comes from a browser. The server keeps it only if it is a real
  time in the past and inside the 90 days. If not, the server records the time when it received the
  version.
- Some browsers kept the history of a note locally before. The first time the history of the note
  opens in such a browser, the browser sends the history to the server, oldest first, with the
  original dates. Then the browser deletes its copy.
- A version contains the title, the content and the images, with their descriptions. The image list
  is sealed as that of a note, with the key of each image. It comes with `imageRefs`, the
  references that it names, which the server claims for the owner of the note, as on a note write.
  The version refers to the attachments, and does not copy them.
- The sweep counts the references of versions as those of notes. Thus, an image stays while a
  version names it. A person who can read the note can read the images of its versions (see
  [Attachments](attachments.md)).
- A version from before images were kept has no `images`. A token adds versions without images.

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
- `images`, `imageAlts`: the images of the note at that time, with their descriptions. Absent on a
  version from before images were kept

## Limitations

- In open mode, the version history is in one browser. If you clear the site data of that browser,
  the history is lost.
- Only the title, the content and the images have versions. Color, font, tags and other fields do
  not.
- Share links and export files do not contain the version history.
