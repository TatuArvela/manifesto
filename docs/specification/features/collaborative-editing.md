# Collaborative Editing

In server mode, multiple users can view and edit notes simultaneously with changes appearing in real time.

## Behavior

- When a user opens a note that another user is also editing, both see each other's changes live
- Changes are broadcast via WebSocket (see [API](../api.md))
- Checkbox toggles from other users appear in real time
- Conflicting edits are resolved gracefully with no data loss

## Presence

- Users can see who else is currently viewing or editing a note
- Presence is indicated visually (e.g., avatars or cursors)
- Presence updates are sent via WebSocket `presence:join` and `presence:leave` events

## Offline and Poor Connections

- Changes queue locally when the connection is lost
- Queued changes sync when the connection is restored
- The UI indicates connection status
