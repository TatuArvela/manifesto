# Tags

Notes can be organized with tags. A note can have zero or more tags.

## Behavior

- Tags are shown on the note card
- Tags are added with the tag button, which opens the tag picker, on the note card and in the editor; it stays open so several can be added at once. Tags are removed from the chips in the editor
- Tags are created inline when added to a note; no predefined tag list is required
- The Tags view lists every tag with the number of notes (neither archived nor trashed) that carry it
- Choosing a tag there filters the view to notes with that tag, and offers four actions on it:
  - **Hide from Notes**: notes with the tag stay out of the Notes view. They are still found through Tags, Search, Reminders, Archive and Trash. A hidden tag is marked in the list, and an empty Notes view says how many notes it is leaving out instead of saying there are none. Hidden tags are a preference (see [Preferences](preferences.md)), so in connected mode they follow the account
  - **Color**: gives the tag one of the note colours, or takes it away again with the plain swatch. A coloured tag is drawn with a dot of its colour before its name, in the Tags view and on the tag chips of the card, the editor and the read-only view. The colours are a preference (`tagColors`, see [Preferences](preferences.md)), so they belong to the user and in connected mode follow the account: on a shared note each person sees their own colours, and a share link or public link shows none. At most 200 tags can hold a colour
  - **Rename**: renames the tag on every note, normalized as the tag picker does it (trimmed, lowercased). Renaming onto a tag a note already has merges the two. A hidden tag stays hidden under its new name, and a coloured tag keeps its colour, unless the tag it merges into has one of its own
  - **Delete**: after a confirmation, removes the tag from every note, stops hiding it and forgets its colour

## Nested Tags

A `/` in a tag makes it a path: `work/clients/acme` sits under `work/clients`, which sits under `work`. Nothing else about a tag changes. It is still one string on the note, a note can carry any number of them from any part of the tree, and a tag written before nesting that happens to hold a `/` is now nested.

- A tag is normalized as before (trimmed, lowercased), and each part of its path is trimmed and empty parts are dropped, so `Work / Clients/` is `work/clients`
- A tag that exists only as the start of another is a tag all the same: with one note tagged `work/clients`, `work` is listed, can be opened, hidden, coloured, renamed and deleted, and is offered in the tag picker
- **Tags view**: the first row holds the top-level tags. Choosing a tag opens a row of the tags directly under it, and so on down, one row for each tag on the way to the chosen one that has any. The first row shows a whole tag (`#work`), the rows below only its last part (`clients`)
- **Filtering and counts**: a tag's notes are those carrying it and those carrying any tag under it, each counted once
- **Hide from Notes** covers the tags under the hidden one. A tag hidden through one above it says which, and is shown again from there
- **Color**: a tag without a colour of its own takes that of the nearest tag above it that has one
- **Rename** moves the tags under the renamed one with it (`work` to `job` makes `work/clients` into `job/clients`), together with whether each is hidden and its colour. Renaming to a path moves a tag elsewhere in the tree (`workshop` to `work/shop`)
- **Delete** removes the tag and every tag under it from all notes, and the confirmation says so
- **Address**: a nested tag's page is `/tags/work/clients/acme`, each part encoded by itself. A link that holds the whole tag in one part (`/tags/work%2Fclients`) opens the same tag
- **MCP**: `list_notes` with a tag returns the notes under it, nested ones included. `list_tags` lists the tags as they are written on the notes

Nested tags are not folders (see [Non-goals](../non-goals.md)): a note is not filed in one place, and the tree is only a way of reading tag names.

## Server Mode

Tags are per-user: each user has their own tag namespace. Renaming or deleting a tag affects all of that user's notes with that tag.
