# Export and Import

Manifesto supports exporting and importing note data from the Settings dialog. This works regardless of the active storage backend.

## Export

- **Export**: Downloads all notes as a single JSON file (`manifesto-export-YYYY-MM-DD.json`)

### From the server (connected mode)

**Download all my notes (.zip)** in Settings, `GET /api/export` (any credential, so an API token can
script a backup), and for an admin **Download notes** on any account (`GET
/api/admin/users/:id/export`) build one zip on the server:

| File | Holds |
|---|---|
| `notes.json` | Every note the account owns, the archive and trash included, in the import format above, with images inlined as `data:` URLs. Importing it restores the notes anywhere, open mode included. |
| `notes/<title>.md` | Each note not in the trash as Markdown, with frontmatter (`title`, `tags`, `pinned`, `archived`, `created`, `updated`) that the Markdown-folder import reads back, for another tool to open. |
| `versions.json` | The server's version history of those notes. |
| `account.json` | The account's username, display name, email address, how it signs in, whether it is an admin and when it was made. |

Notes shared with the account belong to someone else and are not included. It serves a person leaving,
moving servers, or asking what is held about them; each download is recorded in the audit log.
Importing the zip as it is restores it from `notes.json` (same ids, so a note already here is merged,
not duplicated); the Markdown files are the same notes stripped down and are then not read.

## Import

- **Import**: Loads notes from a previously exported JSON file, merging them into the existing notes.
  Import also takes Markdown files (one note each) and Google Keep notes; see below.

Import is offered from the Settings dialog and by dropping files anywhere on the board.

## Markdown

A single `.md` file becomes one note: a leading `# ` heading is the title and the rest is the
content. YAML frontmatter, as Obsidian, SilverBullet and Nextcloud Notes write it, is read too:
`title`, `tags` (or `tag`; a list, `[a, b]` or `a, b`), `pinned` and `archived`. Only that flat
subset is understood; a block with anything else in it, or a note that merely opens with a `---`
rule, stays in the content untouched.

A **folder of Markdown notes** imports as a `.zip`. Every `.md` file in it becomes a note in one
merge, titled after its file when it has no heading or frontmatter title, and tagged with the
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

## Use Cases

- Back up and restore data
- Move between browsers or devices
- Migrate from local storage to a server (or vice versa)

## Format

Exported files are human-readable JSON. A full dataset export contains an array of note objects following the schema in [Data Model](../data-model.md), including all fields (color, font, tags, etc.).

## Validation

On import, each note is validated for required fields (`id`, `title`, `content`, `createdAt`, `updatedAt`, `tags`). Invalid files are rejected with an error message.
