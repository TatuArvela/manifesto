# Export and Import

You can export and import note data from the Settings dialog. This works with all storage backends.

## Export

**Export Notes** in Settings downloads all notes as one zip. The archive is the same in both modes.
The browser builds it from the notes that it has (`exportArchive`, zipped with the
`CompressionStream` of the platform). Its name is `manifesto-export-YYYY-MM-DD.zip`. In connected
mode, the server stores notes [sealed](encryption.md), and has no readable data for an export. Thus,
there is no export route, for an account or for an admin. The browser opens the notes and makes the
file.

The layout comes from `exportArchiveFiles` in `@manifesto/shared`. Thus, you can import an archive
from either mode into either mode:

| File | Holds |
|---|---|
| `manifest.json` | The [format](../data-model.md#format) of the notes and versions, as `{ "format": 1 }`. An import upgrades an older archive. It refuses an archive from a newer version. An archive without this file is from before the app recorded formats, and is format 1. |
| `notes.json` | All notes that the account owns, with the archive and the trash, in the import format above. Images are inlined as `data:` URLs. An import of this file restores the notes in all places, also in open mode. |
| `notes/<title>.md` | Each note that is not in the trash, as Markdown with frontmatter (`title`, `tags`, `pinned`, `archived`, `created`, `updated`). The Markdown-folder import reads it back. Other tools can open it. |
| `versions.json` | The version history of those notes. |
| `preferences.json` | The [preferences](preferences.md) of this browser. It is for storage and for reading. An import of an archive does not change the settings. |

Notes that a different person shared with the account belong to that person. The export does not
include them. The download is for a person who leaves, moves to a different server, or moves notes
onto a [server that encrypts](encryption.md#a-server-from-before-encryption).

When you import the zip as it is, the app restores it from `notes.json`. The ids stay the same. Thus,
if a note is already here, the app merges it, and does not make a duplicate. The Markdown files are
the same notes with less data. In this case, the app does not read them. Then the app puts
`versions.json` under the notes that it belongs to, with the original dates of the versions:

- Only under notes that the importing user owns.
- It skips a version that the note already has. Thus, if you import the same backup two times, the
  second import adds nothing.
- It skips a version that is older than `NOTE_VERSION_MAX_AGE_DAYS`.

## Import

- **Import**: loads notes from an export zip, or from the JSON file that earlier versions exported.
  It merges them into the existing notes. Import also accepts Markdown files (one note each) and
  Google Keep notes. See below.

You can import from the Settings dialog, or when you drop files anywhere on the board. The Data page
of Settings lists the apps and formats that it can read, as chips. Each chip tells which file to
bring from that app. The page also tells what the export contains, adjacent to its button. If you
drop only pictures, with no note open, the app starts a new note
([Notes](notes.md#creating-a-note)).

## Markdown

One `.md` file becomes one note. A `# ` heading at the start is the title, and the remaining text is
the content. The app also reads YAML frontmatter, as Obsidian, SilverBullet and Nextcloud Notes
write it: `title`, `tags` (or `tag`; a list, `[a, b]` or `a, b`), `pinned` and `archived`. The app
knows only that flat subset. A block with other data in it, or a note that only starts with a `---`
rule, stays in the content, and the app does not change it.

A frontmatter `title` wins over a heading, also an empty title, because the Markdown export writes
notes in that way. Thus, a note whose body starts with a heading, or a note without a title, comes
back as it was. If a heading at the start only repeats the frontmatter title, the app removes the
heading, so that the title is not there two times.

A **folder of Markdown notes** imports as a `.zip`. Each `.md` file in it becomes a note, in one
merge.

- If a file has no heading and no `title` in its frontmatter, the name of the file is the title.
- The folders that contain the file become tags. The zipped folder itself, which all entries share,
  is not a tag.
- `created` / `date` and `updated` / `modified` / `lastmod` in the frontmatter become `createdAt` /
  `updatedAt`.
- The app skips `.obsidian/`, `.trash/` and `.git/`, and all files that are not Markdown.

## Google Keep (Takeout)

Google Takeout exports Keep as one JSON file for each note in `Takeout/Keep/`. Attachments are
adjacent files. Import accepts the Takeout `.zip` itself, or the unpacked files (the JSON files,
selected together with their images). The app ignores all other data in the archive, for example the
`.html` copies of Keep and other Google products. The full import runs in the browser. Thus, it also
works in open mode.

| Keep | Note |
|---|---|
| `title`, `textContent` | `title`, `content` |
| `listContent` | a GFM task list (`- [ ]` / `- [x]`), appended to `content` |
| `color` | `color` by name. `CERULEAN` (the darker blue of Keep) becomes `blue` |
| `labels[].name` | `tags` |
| `isPinned`, `isArchived`, `isTrashed` | `pinned`, `archived`, `trashed` |
| `createdTimestampUsec`, `userEditedTimestampUsec` | `createdAt`, `updatedAt` |
| `attachments` (images) | `images`, as `data:` URLs |
| `annotations` with `source: "WEBLINK"` | `linkPreviews`, without thumbnails |

Keep does not record when a note went to the trash. Thus, the `trashedAt` of a trashed note is the
time of the import, and the note gets the full 30 days. The app skips attachments that are not an
accepted image type (voice recordings), and attachments that are larger than the image size limit.
The note imports without them. Each note gets a new ID. Thus, if you import the same Takeout two
times, you get two copies.

The app reads a zip with the `DecompressionStream` of the browser. All entries of the archive share
one byte budget (the 50 MB import limit). Thus, a small archive cannot expand to more than that.

## Other Apps

The app identifies each of these formats from its contents. It imports them as a merge of new notes,
with the dates from the source. Each format is an importer behind one interface
(`utils/importers/`). Thus, to add a format, add it there only.

| From | File | What comes across |
|---|---|---|
| Evernote | `.enex` | Title, text (its HTML as Markdown, checkboxes as a task list), tags, dates, and image attachments as the images of the note. Other attachments (PDFs, audio) have no place on a note. |
| Joplin | `.jex` | Title, text, tags, dates, and the trash. Notebooks and attachments do not come across. A link to an attachment keeps its words. An embedded image is removed. The app skips encrypted items. It refuses an export that contains only encrypted items. |
| Simplenote | the export `.zip`, or its `source/notes.json` | The first line as the title, the remaining lines as text, tags, the pin, dates, and the trash. |
| Standard Notes | the `.json` of a decrypted backup | Title, text, tags, the pin, archive and trash, dates. The app cannot read an encrypted backup. It refuses it as one failed file, never as empty notes. |
| HTML | `.html`, `.htm` | One note for each file. The title of the page, or its first heading, is the title. The body becomes Markdown. |

Apple Notes has no export function. The tools that export it write HTML or Markdown, which import as
above. The app parses HTML into an inert document, where no script runs and no image loads. The same
sanitizer as for all other notes renders the note that it becomes.

## Use Cases

- Make a backup of data, and restore it.
- Move between browsers or devices.
- Move from local storage to a server (or from a server to local storage).

There is no print layout and no PDF export. The print function of the browser is sufficient for a
note (see [Non-goals](../non-goals.md)).

## Format

The `notes.json` of an export is JSON that people can read. It is an array of note objects, as in
the schema in [Data Model](../data-model.md), with all fields (color, font, tags and others). A bare
JSON file of that shape, which earlier versions exported, imports in the same way.

## Validation

At import, the app validates that each note has the required fields (`id`, `title`, `content`,
`createdAt`, `updatedAt`, `tags`). It refuses files that are not valid, with an error message.
