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

## Sharing Notes with People (Connected Mode)

As a user on a server, I want to share a note with people who have accounts there.

- I can share a note from its menu, and choose for each person whether they can edit it or only view it
- Depending on how the server is set up, I either search accounts by name, username or email as I type, or type someone's exact username or email address
- The note reaches them only after they accept my invitation, and I can see who has not answered yet
- I can change what someone can do, or take them off the note, at any time, and it takes effect at once
- The text, images and links are the same for everyone; my color, pin, archive, tags and reminder on the note are mine alone, and so are theirs
- Someone I shared a note with can remove it from their notes, but only I can delete it; while it is in my trash, nobody else sees it
- I can give my account an email address so people can find me by it
- See [Sharing with People](features/sharing-with-people.md)

## Live Collaborative Editing (Connected Mode)

As a user connected to a server, I want to edit notes simultaneously with other users in real time.

- When I open a note I share with other people, or they share with me to edit, and one of them is also editing it, I see their changes appear live
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
- The server is the source of truth: backups, retention, and access control happen there

## Account Administration (Connected Mode)

As the person running a server, I want to manage who has an account on it without touching the database.

- A new server prints a temporary password for its `admin` account when it starts, and I choose my own when I first sign in; nobody can guess their way in before I do
- I can close registration and still add people, because admins create accounts
- I can see every account, with how many notes it has and when it was last used
- With local sign-in, I can create an account and hand its owner a temporary password; they choose their own the first time they sign in
- With local sign-in, I can reset someone's password: they are signed out everywhere, including open tabs, and get a temporary password
- I can make other people admins and take it away again, but the server never ends up with no admin
- I can delete an account along with its notes, after confirming
- I cannot lock myself out from this screen: my own account is changed from the account menu instead
- As any user with local sign-in, I can change my own password from the account menu in the header, which signs out my other devices

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
- In connected mode, tags are per-user (each user has their own tag namespace), including on notes shared with them
