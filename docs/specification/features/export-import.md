# Export and Import

Manifesto supports exporting and importing note data. This works regardless of the active storage backend.

## Individual Notes

- **Export** — Export a single note as a JSON file
- **Import** — Import a single note from a JSON file

## Full Dataset

- **Export** — Download all notes as a single JSON file
- **Import** — Load notes from a previously exported JSON file (user chooses to merge with or replace existing notes)

## Use Cases

- Back up and restore data
- Move between browsers or devices
- Migrate from local storage to a server (or vice versa)
- Share individual notes with others as files

## Format

Exported files are human-readable JSON following the schema in [Data Model](../data-model.md). A single note export contains one note object. A full dataset export contains an array of note objects.
