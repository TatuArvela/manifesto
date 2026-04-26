# Collaborative Editing (Planned)

> **Not yet implemented.** This feature is planned for a future release.

In connected mode, multiple users will be able to view and edit notes simultaneously with changes appearing in real time.

## Planned Behavior

- When a user opens a note that another user is also editing, both see each other's changes live
- Changes are broadcast via WebSocket (see [API](../api.md))
- Checkbox toggles from other users appear in real time
- Conflicting edits are resolved gracefully with no data loss

## Planned Presence

- Users can see who else is currently viewing or editing a note
- Presence is indicated visually (e.g., avatars or cursors)
- Presence updates are sent via WebSocket `presence:join` and `presence:leave` events

## Planned Offline Support

- Changes queue locally when the connection is lost
- Queued changes sync when the connection is restored
- The UI indicates connection status
