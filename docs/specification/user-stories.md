# User Stories

## Local Notes (Open Mode)

As a user, I want to open Manifesto in my browser and write notes immediately. I do not want to make
an account or set up a server.

- I can create, edit, pin, archive, trash, and restore notes.
- The localStorage of the browser keeps my notes.
- My notes stay after I close the browser.
- I can organize notes with colors and tags.
- I can search all of my notes.
- I can use markdown formatting in my notes.

## Import and Export

As a user, I want to move my data in and out of Manifesto freely.

- In both modes, I can export all of my notes, with their version history, as one zip from the
  Settings dialog.
- I can import notes from a JSON file. The app merges them into my existing notes.
- I can bring my notes from Google Keep (a Takeout archive) or from a folder of Markdown notes.
- People can read the exported files. The files use a documented format.

## PWA

As a user who travels, I want to use Manifesto as an app on my phone or tablet.

- I can install Manifesto from the browser on my home screen.
- The app works offline with my locally stored notes.
- The interface is responsive, and it is easy to use with touch.
- When I connect again, the notes sync (if the app is connected to a server).
- I can share text, a link or images from a different app to Manifesto. It opens as a new note.

## Checklists

As a user, I want to use notes as interactive checklists, for example for shopping lists.

- I can write checklist items with the syntax `- [ ]` and `- [x]` in the note content.
- Checkboxes are interactive. I can tap or click them.
- I can toggle checkboxes directly on the note card in the grid view. I do not have to open the
  editor.
- When I toggle a checkbox, the note content changes immediately.
- Checklists and free markdown can be in the same note.

## Sharing

As a user, I want to share a note with a person who does not have an account.

- I can make a share link from each note, through the kebab menu.
- The link encodes the note data in the URL hash fragment (no server is necessary).
- The recipient sees a read-only preview of the shared note.
- The recipient can save the note to their own storage, or discard it.
- Sharing works with all static hosts (for example, GitHub Pages).

## Version History

As a user, I want to look at previous versions of my notes, and restore them.

- When I edit a note, the app automatically saves the previous version.
- I can look at the version history from the kebab menu of the note editor.
- Each version shows the time when the app recorded it.
- I can restore a previous version. It replaces the current content.
- The versions are stored locally. The maximum is 50 for each note.
- The app automatically prunes versions that are older than 90 days.

## Sync Across Devices (Connected Mode)

As a user with many devices, I want my notes on each device where I sign in.

- A connected-mode client (built with `VITE_MANIFESTO_SERVER` set to my server) asks me to log in
  before it shows notes.
- I authenticate with a username and a password, or with single sign-on if the server has OIDC.
- My notes are on the server. Each device that signs in sees the same data.
- When I make a change on one device, it shows on my other open devices through WebSocket events.
- Tags and manual order belong to my account.
- See [Operating Modes](operating-modes.md) for the full comparison of the modes, and for how to
  move between open mode and connected mode.

## Sharing Notes with People (Connected Mode)

As a user on a server, I want to share a note with people who have accounts there.

- I can share a note from its menu. For each person, I select if they can edit it or only view it.
- The setup of the server decides how I find people. Either I search accounts by name, username or
  email while I type, or I type the exact username or email address of a person.
- The note goes to them only after they accept my invitation. I can see who did not answer yet.
- I can change what a person can do, or remove them from the note, at all times. The change applies
  immediately.
- The text, images and links are the same for all persons. My color, pin, archive, tags and reminder
  on the note belong only to me. Their values belong only to them.
- A person who got a note from me can put it in their own trash and restore it, or remove it from
  their notes. Only I can delete it for all persons. While it is in my trash, no other person sees
  it.
- I can give my account an email address, so that people can find me by it.
- See [Sharing with People](features/sharing-with-people.md).

## Live Collaborative Editing (Connected Mode)

As a user connected to a server, I want to edit notes at the same time as other users, in real time.

- I open a note that I share with other people, or that they share with me to edit. If one of them
  also edits it, I see their changes immediately.
- The app sends my changes to the other users who see the same note.
- The app resolves conflicting edits correctly (no data loss).
- I can see who else looks at or edits a note now.
- Checkbox toggles from other users show in real time.
- On a bad connection, the app continues to work (changes wait, and sync when the connection comes
  back).

## Managed Deployment

As an administrator in an organization, I want to deploy Manifesto as a managed service for my team.

- I build the client one time with `VITE_MANIFESTO_SERVER` set to our server. Thus, it uses only that
  backend, with no local-only fallback.
- Users must authenticate before they see the UI. Anonymous use is not possible.
- I can select `STORAGE_DRIVER=postgres`, so that the server uses our managed database.
- I can select `AUTH_PROVIDER=oidc`, so that users sign in with our existing IdP (Authentik,
  Keycloak, Google, Auth0, Okta, …).
- The server is the source of truth. Backups, retention, and access control occur there.

## Account Administration (Connected Mode)

As the person who operates a server, I want to control who has an account on it. I do not want to
change the database directly.

- When a new server starts, it prints a temporary password for its `admin` account. I select my own
  password when I sign in the first time. No person can guess a way in before me.
- I can close registration and still add people, because admins create accounts.
- I can see all accounts, with the number of notes of each one, and its last use.
- With local sign-in, I can create an account and give its owner a temporary password. The owner
  selects their own password at the first sign-in.
- With local sign-in, I can reset the password of a person. The person is signed out on all devices,
  also in open tabs, and gets a temporary password.
- I can make other people admins, and remove that right again. But the server always has a minimum
  of one admin.
- I can delete an account and its notes, after a confirmation.
- I cannot lock myself out from this screen. I change my own account from Settings.
- As a user with local sign-in, I can change my own password from Settings. This signs out my other
  devices.

## Archiving

As a user, I want to archive notes that I do not need in my main view, but that I want to keep.

- I can archive a note from the note card or the editor.
- Archived notes go out of the main view.
- I can see archived notes in the Archive view in the sidebar.
- I can restore an archived note to the main view.
- Archiving does not change the content or the metadata of the note.

## Soft Delete (Trash)

As a user, I want protection when I delete notes.

- When I delete a note, it moves to the trash (soft delete).
- I can see trashed notes in the Trash view in the sidebar.
- I can restore a trashed note to its previous state.
- I can permanently delete a note from the Trash view.
- Notes in the trash expire automatically after 30 days.
- The Trash view shows when each note went to the trash.

## Tags

As a user, I want to organize my notes with tags.

- I can add one or more tags to a note.
- I can filter notes by tag in the sidebar.
- The note card shows the tags.
- I can manage tags (rename, delete).
- The app creates a tag when I add it to a note (no predefined tag list is necessary).
- In connected mode, each user has their own tags (their own tag namespace). This includes the
  notes that other people share with them.
