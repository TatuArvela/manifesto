# Export and Import

Manifesto supports exporting and importing note data from the Settings dialog. This works regardless of the active storage backend.

## Export

**Export Notes** in Settings downloads every note as one zip, the same archive in both modes:

- **Connected mode**: the server builds it for the account (`GET /api/export`, which takes any
  credential, so an API token can script a backup), named `<username>-notes-YYYY-MM-DD.zip`. With
  `ADMIN_EXPORT` on, an admin can download any account's with **Download notes**
  (`GET /api/admin/users/:id/export`), and the account's owner sees it on their Activity page
  ([Privacy](privacy.md)).
- **Open mode**: the browser builds it from what it holds (`exportArchive`, zipped with the platform's
  `CompressionStream`), named `manifesto-export-YYYY-MM-DD.zip`.

Both write the layout `exportArchiveFiles` in `@manifesto/shared` defines, so an archive from either
mode imports into either:

| File | Holds |
|---|---|
| `notes.json` | Every note the account owns, the archive and trash included, in the import format above, with images inlined as `data:` URLs. Importing it restores the notes anywhere, open mode included. |
| `notes/<title>.md` | Each note not in the trash as Markdown, with frontmatter (`title`, `tags`, `pinned`, `archived`, `created`, `updated`) that the Markdown-folder import reads back, for another tool to open. |
| `versions.json` | The version history of those notes. |
| `preferences.json` | The [preferences](preferences.md): the account's as the server holds them in connected mode, this browser's in open mode. For keeping and reading; importing an archive leaves the settings as they are. |
| `account.json` | Connected mode only: the account's username, display name, email address, how it signs in, whether it is an admin and when it was made. |

Notes shared with the account belong to someone else and are not included. A server's download serves a
person leaving, moving servers, or asking what is held about them; each one is recorded in the audit
log. Importing the zip as it is restores it from `notes.json` (same ids, so a note already here is
merged, not duplicated); the Markdown files are the same notes stripped down and are then not read.
`versions.json` is then filed under the notes it belongs to, with the dates the versions were taken:
only under notes the importing user owns, skipping a version the note already has (so importing the
same backup twice adds nothing) and one past `NOTE_VERSION_MAX_AGE_DAYS`.

## Import

- **Import**: Loads notes from an export zip, or from the JSON file earlier versions exported, merging
  them into the existing notes. Import also takes Markdown files (one note each) and Google Keep
  notes; see below.

Import is offered from the Settings dialog and by dropping files anywhere on the board.

## Markdown

A single `.md` file becomes one note: a leading `# ` heading is the title and the rest is the
content. YAML frontmatter, as Obsidian, SilverBullet and Nextcloud Notes write it, is read too:
`title`, `tags` (or `tag`; a list, `[a, b]` or `a, b`), `pinned` and `archived`. Only that flat
subset is understood; a block with anything else in it, or a note that merely opens with a `---`
rule, stays in the content untouched.

A frontmatter `title` wins over a heading, even an empty one, since that is how the Markdown export
writes a note: a note whose body opens with a heading, or an untitled one, comes back as it left. A
leading heading that only repeats the frontmatter title is dropped rather than kept twice.

A **folder of Markdown notes** imports as a `.zip`. Every `.md` file in it becomes a note in one
merge, titled after its file when it has no heading and no `title` in its frontmatter, and tagged with the
folders it sits in (the zipped folder itself, which every entry shares, is not a tag). `created` /
`date` and `updated` / `modified` / `lastmod` in the frontmatter become `createdAt` / `updatedAt`.
`.obsidian/`, `.trash/` and `.git/` are skipped, as is anything that is not Markdown.

## Google Keep (Takeout)

Google Takeout exports Keep as one JSON file per note in `Takeout/Keep/`, with attachments as
sibling files. Import accepts either the Takeout `.zip` itself or the unpacked files (the JSON files,
picked together with their images). Everything else in the archive is ignored, including Keep's
`.html` copies and other Google products. The whole import runs in the browser, so it works in open
mode too.

| Keep | Note |
|---|---|
| `title`, `textContent` | `title`, `content` |
| `listContent` | a GFM task list (`- [ ]` / `- [x]`) appended to `content` |
| `color` | `color` by name; `CERULEAN` (Keep's darker blue) becomes `blue` |
| `labels[].name` | `tags` |
| `isPinned`, `isArchived`, `isTrashed` | `pinned`, `archived`, `trashed` |
| `createdTimestampUsec`, `userEditedTimestampUsec` | `createdAt`, `updatedAt` |
| `attachments` (images) | `images`, as `data:` URLs |
| `annotations` with `source: "WEBLINK"` | `linkPreviews`, without thumbnails |

Keep does not record when a note was trashed, so a trashed note's `trashedAt` is the time of the
import, which gives it the full 30 days. Attachments that are not an accepted image type (voice
recordings) or exceed the image size limit are skipped; the note imports without them. Each note gets
a new ID, so importing the same Takeout twice gives two copies.

A zip is read with the browser's own `DecompressionStream`; entries are inflated against one byte
budget shared by the whole archive (the 50 MB import cap), so a small archive cannot inflate past it.

## Other Apps

Each of these is recognised by its contents, and imported as a merge of new notes, dated as the source
dated them. Formats are importers behind one interface (`utils/importers/`), so another is added there
and nowhere else.

| From | File | What comes across |
|---|---|---|
| Evernote | `.enex` | Title, text (its HTML as Markdown, checkboxes as a task list), tags, dates, and image attachments as the note's images. Other attachments (PDFs, audio) have no place on a note. |
| Joplin | `.jex` | Title, text, tags, dates, and the trash. Notebooks and attachments stay behind; a link to an attachment keeps its words, an embedded image goes. Encrypted items are skipped, and an export of nothing else is refused. |
| Simplenote | the export `.zip`, or its `source/notes.json` | The first line as the title, the rest as text, tags, the pin, dates, and the trash. |
| Standard Notes | a decrypted backup's `.json` | Title, text, tags, the pin, archive and trash, dates. An encrypted backup cannot be read here and is refused as one failed file, never as empty notes. |
| HTML | `.html`, `.htm` | One note per file, titled by the page's title or first heading, its body as Markdown. |

Apple Notes has no export of its own. The tools that export it write HTML or Markdown, which import as
above. HTML is parsed into an inert document, where no script runs and no image loads, and the note it
becomes is rendered through the same sanitizer as any other.

## Use Cases

- Back up and restore data
- Move between browsers or devices
- Migrate from local storage to a server (or vice versa)

There is no print layout or PDF export; the browser's own print covers a note (see [Non-goals](../non-goals.md)).

## Format

An export's `notes.json` is human-readable JSON: an array of note objects following the schema in [Data Model](../data-model.md), including all fields (color, font, tags, etc.). A bare JSON file of that shape, which earlier versions exported, imports the same way.

## Validation

On import, each note is validated for required fields (`id`, `title`, `content`, `createdAt`, `updatedAt`, `tags`). Invalid files are rejected with an error message.
