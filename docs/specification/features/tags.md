# Tags

You can organize notes with tags. A note can have zero or more tags.

## Behavior

- The note card shows the tags.
- To add tags, use the tag button on the note card and in the editor. The button opens the tag
  picker. The picker stays open, so you can add many tags at one time. To remove a tag, use its chip
  in the editor.
- The app creates a tag when you add it to a note. You do not need a predefined tag list.
- The Tags view lists all tags. Each tag shows the number of notes that have it. That number does
  not include archived or trashed notes.
- When you select a tag there, the view shows only the notes with that tag. The view also shows four
  actions for the tag:
  - **Hide from Notes**: notes with the tag do not show in the Notes view. You can still find them
    through Tags, Search, Reminders, Archive and Trash. The list marks a hidden tag. An empty Notes
    view tells how many notes it does not show. It does not say that there are no notes. Hidden tags
    are a preference (see [Preferences](preferences.md)). Thus, in connected mode they go with the
    account.
  - **Color**: gives the tag one of the note colors. To remove the color, select the plain swatch.
    The app draws the chip of a colored tag in that color, with an outline of the same hue. Thus,
    you can read the chip on a note of the same color. This applies in the Tags view, on the card,
    in the editor and in the read-only view. The colors are a preference (`tagColors`, see
    [Preferences](preferences.md)). Thus, they belong to the user, and in connected mode they go
    with the account. On a shared note, each person sees their own colors. A share link or a public
    link shows no colors. A maximum of 200 tags can have a color.
  - **Rename**: changes the name of the tag on all notes. The new name is normalized in the same way
    as in the tag picker (trimmed, lowercase). If a note already has the new name, the two tags
    merge. A hidden tag stays hidden with its new name. A colored tag keeps its color, unless the
    tag that it merges into has its own color.
  - **Delete**: after a confirmation, removes the tag from all notes, stops the hide, and deletes
    the color.

## Nested Tags

A `/` in a tag makes the tag a path: `work/clients/acme` is under `work/clients`, which is under
`work`. No other part of a tag changes. It is still one string on the note. A note can have any
number of tags from any part of the tree. If an older tag contains a `/`, it is now nested.

- A tag is normalized as before (trimmed, lowercase). The app also trims each part of the path, and
  removes empty parts. Thus, `Work / Clients/` becomes `work/clients`.
- A tag that is only the start of a different tag is also a tag. If one note has the tag
  `work/clients`, the list shows `work`. You can open, hide, color, rename and delete `work`, and
  the tag picker shows it.
- **Tags view**: a tree, with one tag on each line, and its count.
  - At tablet width and larger, the tree is a sidebar of the Tags view. It is a pane of the shell,
    adjacent to the navigation rail, with full height. The board and its notes start after it. It
    slides out from the rail when the view opens.
  - On a phone, it is the same tree on the same surface, as a band across the top of the notes. The
    band scrolls away with the notes. If the tree is taller than approximately half of the screen,
    it scrolls separately.
  - A tag with tags under it has a chevron. The chevron opens and closes the tags under it, which
    are indented. When you select a tag, the tree opens it and each tag above it. Thus, a link to a
    nested tag shows its position.
  - A top-level tag shows its full name (`#work`). The tags below it show only their last part
    (`clients`).
  - Each tag is a chip, in its color if it has a color. The line of the selected tag has a mark.
    Thus, a selected tag and a blue tag do not look the same.
  - The actions for the selected tag come after the tree, as a list, with one action on each line.
- **Filtering and counts**: the notes of a tag are the notes with that tag, and the notes with a tag
  under it. The app counts each note one time.
- **Hide from Notes** also applies to the tags under the hidden tag. A tag that is hidden through a
  tag above it tells which tag. To show it again, use that tag.
- **Color**: a tag without its own color gets the color of the nearest tag above it that has one.
- **Rename** also moves the tags under the renamed tag (`work` to `job` changes `work/clients` to
  `job/clients`). Each one keeps its hide setting and its color. A rename to a path moves a tag to a
  different position in the tree (`workshop` to `work/shop`).
- **Delete** removes the tag, and each tag under it, from all notes. The confirmation tells this.
- **Address**: the page of a nested tag is `/tags/work/clients/acme`, with each part encoded
  separately. A link that has the full tag in one part (`/tags/work%2Fclients`) opens the same tag.
- **MCP**: `list_notes` with a tag returns the notes under it, and the nested notes too. `list_tags`
  lists the tags as the notes have them.

Nested tags are not folders (see [Non-goals](../non-goals.md)). A note is not in one place. The tree
is only a way to read tag names.

## Server Mode

Each user has their own tags, in their own namespace. When a user renames or deletes a tag, this
changes all of the notes of that user that have the tag.
