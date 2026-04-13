# Trash

Deleting a note is a soft delete — it moves the note to trash rather than permanently removing it.

## Behavior

- Deleting a note sets `trashed: true` and records `trashedAt` (see [Data Model](../data-model.md))
- Trashed notes are accessible from the Trash view in the sidebar
- The trash view shows when each note was trashed
- A trashed note can be restored to its previous state (active or archived)
- A trashed note can be permanently deleted from the Trash view
- Notes in trash auto-expire after 30 days (checked on app initialization)

