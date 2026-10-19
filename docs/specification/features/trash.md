# Trash

When you delete a note, the app does a soft delete. The note moves to the trash. The app does not
remove the note permanently.

## Behavior

- When you delete a note, the app sets `trashed: true` and records `trashedAt` (see
  [Data Model](../data-model.md)).
- The card becomes smaller to its centre until it is gone. The same animation plays when you delete
  a note permanently from the Trash. A restored card moves up and out of the Trash view, with a
  glow. No animation plays for a card that stays in the current view after the change. An example
  is a search that includes both places.
- To see the trashed notes, open the Trash view in the sidebar.
- The Trash view shows when each note went to the trash.
- You can restore a trashed note to its previous state (active or archived).
- You can delete a trashed note permanently from the Trash view.
- A note in the trash expires automatically after 30 days (`TRASH_RETENTION_DAYS`). In open mode,
  the app does this check when it starts. In connected mode, the server does the check each hour,
  and the client does not do it.
- In connected mode, a note [shared with you](sharing-with-people.md#trash) goes to your own trash.
  It stays in the notes of the other people. When you delete it permanently, it goes out of your
  notes only. When the owner moves a note to the trash, the note goes out of the notes of all the
  people who have it.
