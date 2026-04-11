# User Stories

## Local Notes (Open Mode)

As a user, I want to open Manifesto in my browser and start taking notes immediately, without creating an account or setting up a server.

- I can create, edit, pin, archive, trash, and restore notes
- My notes are stored in the browser's localStorage
- My notes persist across browser sessions
- I can organize notes with colors and tags
- I can search across all my notes
- I can use markdown formatting in my notes

## Import and Export

As a user, I want to move my data in and out of Manifesto freely.

- I can export a single note as a JSON file
- I can export all my notes as a single JSON file
- I can import a single note from a JSON file
- I can import a full dataset from a JSON file, choosing to merge with or replace existing notes
- Exported files are human-readable and follow a documented format

## PWA

As a user on the go, I want to use Manifesto as an app on my phone or tablet.

- I can install Manifesto from the browser to my home screen
- The app works offline with my locally stored notes
- The interface is responsive and touch-friendly
- Notes sync when I reconnect (if connected to a server)

## Checklists

As a user, I want to use notes as interactive checklists for things like shopping lists.

- I can write checklist items using `- [ ]` and `- [x]` syntax in the note content
- Checkboxes render as interactive, tappable/clickable elements
- I can toggle checkboxes directly from the note card in the grid view, without opening the editor
- Toggling a checkbox updates the note content in real time
- Checklists and freeform markdown coexist in the same note
- Checklist interaction works on content-locked notes (see [Locking](features/locking.md))

## Connecting to a Server (Open Mode)

As a user, I want to optionally connect my client to a server for persistent storage and multi-device access.

- I can enter a server URL in settings to connect
- I authenticate with the server (login/register)
- My notes are stored on the server and accessible from any device
- I can disconnect and return to local-only mode at any time
- I can connect to any server that implements the Manifesto API

## Live Collaborative Editing (Server Mode)

As a user connected to a server, I want to edit notes simultaneously with other users in real time.

- When I open a note that another user is also editing, I see their changes appear live
- My changes are broadcast to other users viewing the same note
- Conflicting edits are resolved gracefully (no data loss)
- I can see who else is currently viewing or editing a note
- Checkbox toggles from other users appear in real time
- The experience degrades gracefully on poor connections (changes queue and sync when reconnected)

## Managed Deployment

As an organization administrator, I want to deploy Manifesto as a managed service for my team.

- I can configure the app to only work with my server (managed mode)
- Users must authenticate to use the app
- There is no local-only mode — the server is the source of truth
- I can manage users and their access

## Note Locking

As a user, I want to lock notes to prevent accidental edits.

- I can set a note to unlocked, content-locked, or fully-locked (see [Locking](features/locking.md))
- The lock level is set from the note's toolbar or context menu
- A lock icon on the note card indicates the current lock state
- Trashing a locked note requires unlocking it first
- In server mode, lock state is synced across all users

## Archiving

As a user, I want to archive notes I no longer need in my main view but want to keep.

- I can archive a note from the note card or editor
- Archived notes disappear from the main view
- I can access archived notes from the Archive view in the sidebar
- I can restore an archived note back to the main view
- Archiving does not affect the note's content or metadata

## Soft Delete (Trash)

As a user, I want a safety net when deleting notes.

- Deleting a note moves it to trash (soft delete)
- Trashed notes are accessible from the Trash view in the sidebar
- I can restore a trashed note back to its previous state
- I can permanently delete a note from the Trash view
- Notes in trash auto-expire after 30 days
- The trash view shows when each note was trashed

## Tags

As a user, I want to organize my notes with tags.

- I can add one or more tags to a note
- I can filter notes by tag in the sidebar
- Tags are shown on the note card
- I can manage (rename, delete) tags
- Tags are created inline when added to a note (no predefined tag list required)
- In server mode, tags are per-user (each user has their own tag namespace)
