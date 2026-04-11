# Locking

Notes can be locked to prevent accidental edits. The `lock` field on a note (see [Data Model](../data-model.md)) controls what can be changed.

## Lock Levels

### Unlocked

Default state. The note can be freely edited — title, content, color, tags, pin, archive, and all interactive elements.

### Content-Locked

Title and text content cannot be edited. Clicking the note card does not open the editor.

**Still allowed:**
- Toggling checkboxes (not considered a content edit)
- Changing color, tags, pin, and archive status

### Fully-Locked

Completely read-only. Nothing can be changed — no edits, no checkbox interaction, no metadata changes. The note can still be viewed.

## UI

- The lock level is set from the note's toolbar or context menu
- A lock icon on the note card indicates the current lock state
- Trashing a locked note requires unlocking it first

## Server Mode

Lock state is synced across all users. If one user locks a note, all users see it as locked.
