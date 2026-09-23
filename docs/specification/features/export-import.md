# Export and Import

Manifesto supports exporting and importing note data from the Settings dialog. This works regardless of the active storage backend.

## Export

- **Export**: Downloads all notes as a single JSON file (`manifesto-export-YYYY-MM-DD.json`)

## Import

- **Import**: Loads notes from a previously exported JSON file, merging them into the existing notes.
  Import also takes Markdown files (one note each) and Google Keep notes; see below.

Import is offered from the Settings dialog and by dropping files anywhere on the board.

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
