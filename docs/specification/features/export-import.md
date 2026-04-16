# Export and Import

Manifesto supports exporting and importing note data from the Settings dialog. This works regardless of the active storage backend.

## Export

- **Export** — Downloads all notes as a single JSON file (`manifesto-export-YYYY-MM-DD.json`)

## Import

- **Import** — Loads notes from a previously exported JSON file, merging them into the existing notes

## Use Cases

- Back up and restore data
- Move between browsers or devices
- Migrate from local storage to a server (or vice versa)

## Format

Exported files are human-readable JSON. A full dataset export contains an array of note objects following the schema in [Data Model](../data-model.md), including all fields (color, font, tags, etc.).

## Validation

On import, each note is validated for required fields (`id`, `title`, `content`, `createdAt`, `updatedAt`, `tags`). Invalid files are rejected with an error message.
