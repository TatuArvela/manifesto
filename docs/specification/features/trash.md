# Trash

Deleting a note is a soft delete: it moves the note to trash rather than permanently removing it.

## Behavior

- Deleting a note sets `trashed: true` and records `trashedAt` (see [Data Model](../data-model.md))
- The card drops and shrinks away as it goes; a restored one swells slightly as it fades out of the Trash view. Neither plays for a card that the change leaves in the current view, such as a search that covers both places
- Trashed notes are accessible from the Trash view in the sidebar
- The trash view shows when each note was trashed
- A trashed note can be restored to its previous state (active or archived)
- A trashed note can be permanently deleted from the Trash view
- Notes in trash auto-expire after 30 days (checked on app initialization)
- In connected mode, a note [shared with you](sharing-with-people.md#trash) goes to your own trash and leaves nobody else's notes; deleting it permanently takes it out of your notes only. A note its owner trashes disappears for everyone it was shared with

