# Tags

Notes can be organized with tags. A note can have zero or more tags.

## Behavior

- Tags are shown on the note card
- Tags are added with the tag button, which opens the tag picker, on the note card and in the editor; it stays open so several can be added at once. Tags are removed from the chips in the editor
- Tags are created inline when added to a note; no predefined tag list is required
- The Tags view lists every tag with the number of notes (neither archived nor trashed) that carry it
- Choosing a tag there filters the view to notes with that tag, and offers three actions on it:
  - **Hide from Notes**: notes with the tag stay out of the Notes view. They are still found through Tags, Search, Reminders, Archive and Trash. A hidden tag is marked in the list, and an empty Notes view says how many notes it is leaving out instead of saying there are none. Hidden tags are a preference, so they are per device like the others
  - **Rename**: renames the tag on every note, normalized as the tag picker does it (trimmed, lowercased). Renaming onto a tag a note already has merges the two. A hidden tag stays hidden under its new name
  - **Delete**: after a confirmation, removes the tag from every note, and stops hiding it

## Server Mode

Tags are per-user: each user has their own tag namespace. Renaming or deleting a tag affects all of that user's notes with that tag.
