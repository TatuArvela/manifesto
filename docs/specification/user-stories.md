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

- I can export all my notes as a single JSON file from the Settings dialog
- I can import notes from a JSON file, merging them into my existing notes
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

## Sharing

As a user, I want to share a note with someone without requiring them to have an account.

- I can generate a share link from any note via the kebab menu
- The link encodes the note data in the URL hash fragment (no server required)
- The recipient sees a read-only preview of the shared note
- The recipient can save the note to their own storage or discard it
- Sharing works with any static host (e.g., GitHub Pages)

## Version History

As a user, I want to review and restore previous versions of my notes.

- When I edit a note, the previous version is automatically saved
- I can browse the version history from the note editor's kebab menu
- Each version shows the timestamp when it was captured
- I can restore a previous version, replacing the current content
- Versions are stored locally and capped at 50 per note
- Versions older than 90 days are automatically pruned

## Sync Across Devices (Connected Mode)

As a user with multiple devices, I want my notes to follow me wherever I sign in.

- A connected-mode client (built with `VITE_MANIFESTO_SERVER` pointing at my server) prompts me to log in before showing any notes
- I authenticate with username + password, or with single sign-on if the server is configured for OIDC
- My notes live on the server; every device that signs in sees the same data
- Changes I make on one device appear on my other open devices via WebSocket fan-out
- Tags and manual ordering are scoped to my account
- See [Operating Modes](operating-modes.md) for the full mode comparison and migration path between open and connected mode

## Live Collaborative Editing (Connected Mode) — Planned

> **Transport implemented, editor wiring planned.** The Yjs/Hocuspocus channel at `/api/yjs/notes/<id>` is in place; the editor does not yet bind to it.

As a user connected to a server, I want to edit notes simultaneously with other users in real time.

- When I open a note that another user is also editing, I see their changes appear live
- My changes are broadcast to other users viewing the same note
- Conflicting edits are resolved gracefully (no data loss)
- I can see who else is currently viewing or editing a note
- Checkbox toggles from other users appear in real time
- The experience degrades gracefully on poor connections (changes queue and sync when reconnected)

## Managed Deployment

As an organization administrator, I want to deploy Manifesto as a managed service for my team.

- I build the client once with `VITE_MANIFESTO_SERVER` pointing at our server, so it is locked to that backend with no local-only fallback
- Users must authenticate before seeing any UI; there is no anonymous use
- I can choose `STORAGE_DRIVER=postgres` so the server runs against our managed database
- I can choose `AUTH_PROVIDER=oidc` so users sign in with our existing IdP (Authentik, Keycloak, Google, Auth0, Okta, …)
- The server is the source of truth — backups, retention, and access control happen there

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
- In connected mode, tags are per-user (each user has their own tag namespace)
