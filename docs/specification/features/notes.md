# Notes

Notes are the main entity in Manifesto. A note is a card with a title, markdown content, and
metadata.

## Creating a Note

A persistent "Take a note..." input bar is at the top of the note grid. When it gets focus, it
expands and shows separate title and content fields.

- Done (✓) creates the note, also an empty note.
- All other ways to close it (Escape, a click outside, the back arrow on phones) create the note only
  if it has a title, content, images or link previews. Thus, if you open the pad accidentally,
  nothing stays.
- The discard button (✕) deletes the draft.

The device keeps the draft while you write. The draft comes back the next time that the pad opens.
Thus, a reload, a closed tab or a phone that stops the app loses nothing. When you save or discard
the note, the app clears the draft. A device keeps one draft. If two tabs write at the same time, the
last write stays. A note shared to the installed app opens in the pad in place of the draft. The app
then saves the existing draft as a separate note.

You can also start a note from the board without opening the pad first:

- **Pasting**: if no field for text has focus, and no note, dialog or menu is open, a paste opens the
  pad with the clipboard in it. The text becomes the text of the note (its links become preview
  cards, as in the pad), and its pictures are attached. A paste into a field or an open note goes to
  that field.
- **Dropping pictures**: if no note is open, a drop of pictures anywhere on the window opens the pad
  with them attached. The drop zone tells this while you drag them over it. A drop of other files
  imports them, as before ([Export / Import](export-import.md)).

Both go to the notes view if a different view shows. They keep the tag that you look at there. The
app makes pictures smaller and checks them, as for an attached picture
([Attachments](attachments.md)).

In connected mode, the device puts a new note in a queue before it sends it. Thus, a note written
while the server is not available is not lost.

- The app sends it when there is a reason to think that the server is back (the browser goes online,
  the app reconnects, the account is unlocked). It uses the id that the note got in the queue. Thus,
  if the answer for a note was lost, the server finds the note, and does not make it two times.
- A note that is sent immediately never shows as waiting.
- A note that is not sent immediately shows above the board as waiting to be sent. You can take it
  back into the pad to change it, or discard it.
- If the server refuses a note as it is (for example, too long), the app does not send it again, and
  tells you.
- These notes are not on the board until they arrive, because no other place stores them yet.

When the pad opens, its top sheet peels off first. Only when the sheet is free does the editor grow
out of it. On a phone, where the pad is a floating + button, the editor grows out of the button.

New notes have these defaults: color `default` (or the default color that the user selected, which
can be random), font `default` (or the default that the user selected), not pinned, not archived,
not trashed, no tags.

## Editing a Note

When you click a NoteCard, the NoteEditor opens as a modal overlay. It grows out of the card. When
you close it, it shrinks back onto the card. A card that you cannot see (scrolled away, or opened
from a notification) fades in and out. With Settings > Appearance > Animations off, the editor shows
immediately. The editor has:

- A title field (plain text).
- A content field: a rich markdown editor, with a raw mode that shows and edits the markdown source.
  Settings > Defaults > Default Edit Mode selects the mode in which a note opens. In connected mode,
  raw edits go to collaborators while you type, and their edits show in the textarea.
- Links that you edit as text. A click puts the caret in the link, and does not follow it. While the
  caret is in a link, an "Open link" button under it (or Mod-Enter) opens it in a new tab. The app
  opens only web addresses and mail addresses.
- A formatting toolbar (headings, bold, italic, quotes, code, links, lists, checklists). In raw mode,
  its buttons insert the markdown syntax. You can hide it under Settings > Features. This hides it in
  all notes.
- A color picker.
- A font picker, the "T" button (Default, Serif, Monospace, Permanent Marker, Comic Relief, Rouge
  Script). On a phone, it is in the kebab menu.
- A tag button, which opens the tag picker.
- A kebab menu, in groups:
  - The tools of the note (version history, Checklist).
  - Commands that send it to a different place (Share, Download, Duplicate).
  - Its position (Move, Archive).
  - Delete.

  Checklist, Share, Download and Move are submenus. With a mouse, a submenu opens adjacent to the
  menu when the pointer stays on its row (or on a press, or the right arrow). On a touch screen, it
  opens in place of the menu, behind a back row. Escape also goes back. A submenu with only one row
  shows that row in its place.
- A toolbar with pin, archive, and undo/redo actions.

On a phone, the editor fills the screen. Its buttons, icons, title and text are a fifth larger than
on a desktop. When the bottom toolbar does not fit on one row, its first two tools move to a row
above. Thus, the menu, undo/redo and Done stay near the thumb.

The app saves changes when the editor closes (or after a debounce during editing).

## Board Background

Settings > Board Background is a separate page. It controls the area behind the notes, in two
sections, Color and Pattern. Each choice applies immediately:

- **Color**:
  - None (the color of the page).
  - White, gray or black (light to dark in both themes). Black is a charcoal in the light theme, and
    white is a slate in the dark theme. Thus, the headings of the page are still legible over them.
  - A preset (red, orange, yellow, green, teal, blue, purple or pink, the hues of the note colors). In
    the light theme, it is a clear pastel, one step stronger than a note of that color. In the dark
    theme, it is one step deeper.
  - A custom color from the system picker. In the light theme, it shows as you selected it. In the
    dark theme, the app mixes it deep into the page color.
  - **Random** puts a different preset on the board on each visit. If you select it again, it
    selects a different one.
- **Second Color**: none for a flat board, or a second color to which the board fades from the
  first. You select it in the same way. A random second color is never the preset of the first
  color.
  - A board with one of the earlier muted presets (Sand, Sage, Mist, Blush, Lavender, Caramel) shows
    the nearest preset. A board with the earlier Cork, Felt or Linen pattern shows Paper.
  - When a second color is set, **Direction** shows eight sides and corners on a compass. Each one is
    drawn as the gradient that it makes. **Random** is in the middle. A corner goes from corner to
    corner, on a board of any shape.
- **Pattern**: Plain, Paper, Dots, Grid, Lines, Waves, Confetti, Stars, Hearts, Bubbles, Stripes or
  Sawtooth (the logo in rows turned 45°, with a line between the rows that has barbs from its
  notches). The app draws it over the color. The patterns are CSS gradients and inline SVG. Thus, no
  image files are necessary. **Random** puts a different pattern (never Plain) on the board on each
  visit. If you select it again, it selects a different one.
- **Pattern Color**:
  - Gray (the default, between White and Black) draws each pattern in ink that follows the theme:
    black in light, white in dark.
  - White, black, one of the eight presets in their vivid shade, or a custom color draws it in that
    color in both themes.
  - **Random** draws in a different preset on each visit. If you select it again, it selects a
    different one.
- **Pattern Opacity**: a slider from 0% to 100% (10% by default) for the opacity of the pattern.
  - Each pattern is a mask over one layer that has the pattern color and this opacity. Thus, each
    mark of each pattern, in each color, has this opacity (the paper grain is noise, so its opacity
    is up to this value).
  - When you move the slider or change the color, the app draws nothing again.
  - The slider is disabled while there is no pattern.
- **Picture**: one of the pictures of the user. It covers the full board in place of the colors and
  the pattern.
  - The app scales it to a maximum of 2560px on its longest side, and keeps it in IndexedDB on the
    device.
  - It is under a thin scrim in the color of the theme. Thus, the headings stay legible.
  - When you select a color or a pattern, the app puts the picture aside, but does not delete it. Tap
    its thumbnail to show it again.

These choices apply to each device. They do not sync, as the other device preferences.

## Top Bar on Phones

On a narrow screen, the top bar (the header and the row of view buttons under it) stays at the top
of the screen while the board scrolls. If you turn off Settings > Appearance > Keep Top Bar in View
on Phones, it scrolls away with the board. Then the notes get the full screen. It comes back when you
scroll the board to the top, and while notes are selected, because the actions for the selection are
in it. Wider screens always keep it.

## Colors

You can give a note a color from a predefined set (see `NoteColor` in
[Data Model](../data-model.md)). The color is the background of the note card. Each color has a light
theme variant and a dark theme variant.

## Pinning

The pin icon toggles `pinned: true/false`. Pinned notes show in a separate section at the top of the
grid, with the label "Pinned." Unpinned notes show below, under "Others" (the label shows only when
there are pinned notes). A note that you pin goes to the start of the Pinned section. When you unpin
a note, its position does not change.

## Ordering

You can sort notes in three modes. Select the mode in the header:

- **Default**: manual order with drag-and-drop. New notes go to the start of the board, newest first.
  The `position` of a new note is minus its creation time, or one step before the lowest existing
  position if that is lower. The user can move notes freely with a drag. The `position` field keeps
  the custom position (see [Data Model](../data-model.md)).
- **Updated**: the last updated note first.
- **Created**: the most recently created note first.

The pinned section and the unpinned section each keep their own order. In default mode, each section
has its own drag-and-drop sequence.

- While you drag a note, the other notes move to show the order that a drop gives. The note takes the
  position of the note under the pointer. Its own position in the preview stays empty, because the
  note shows under the pointer (on a touch screen, a lifted copy that follows the finger).
- If you hold the note near the top or bottom edge of the board, the board scrolls. This works for a
  finger and for a mouse.
- The drag always moves the full card. A link preview or an image inside it does not move
  separately. A long press on one lifts the card, and does not open the link menu or the image menu
  of the system.
- If you release the note outside the section, all notes go back to their positions.

In connected mode, each user has their own manual order.

## Grid and List Views

- **Grid view** (default): a responsive grid, similar to masonry. Notes have different heights from
  their content (with a maximum, and overflow). The number of columns follows the width of the
  window. Thus, a card keeps approximately the same width, and a larger screen shows more notes, not
  larger notes.
  - **Big notes** (the default) are approximately 250px wide, from one column on a phone up to ten
    on a very wide screen.
  - **Small notes** are approximately 180px wide, from two columns up to fifteen.
  - The choice is in the view menu, adjacent to fit and square.
- **List view**: one column with full width.

A ViewToggle button in the header changes the view.

A view with no notes shows a drawing of its contents, with a line that tells why it is empty and how
a note gets there:

- A pad of blank notes on the Notes view.
- A tidy archive box on the Archive.
- An empty bin on the Trash. It also tells how long the trash keeps a note.
- A quiet alarm clock on Reminders.
- A blank tag for a tag with no notes.
- A magnifying glass on Search.

The drawings are lines in the text color. Thus, they follow the theme. A screen reader skips them,
and reads the words. If a hidden tag keeps notes out of the Notes view, the view shows their count,
and does not say that there are no notes.

**Board Style** (Settings, Appearance, Notes, selected from a small sample board of each) is
**Tidy** by default. On a Tidy board, each card is level.

- On a **Messy** board, each card in the grid leans one or two degrees, as real sticky notes do. The
  angle is between half a degree and two degrees, in either direction. The app calculates it from the
  id of the note. Thus, a note always leans in the same direction on all devices and after a reload.
- A card becomes level while the pointer is on it, while it has focus, or while you hold it.
- The list view stays level. Its cards have the full width of the board, and one degree there makes a
  visible step at the edge.

## Selecting Notes

You can pin, tag, recolor, archive or delete selected notes together from the header. While a note
is selected, the header becomes a selection bar.

- Its tag panel lists all tags, each with a box:
  - The box is checked when all of the selected notes have the tag.
  - It is dashed when only some of them have it.
  - It is empty when none of them has it.
- If you select a tag that they all have, the app removes it from them. If you select a different
  tag, the app adds it to the notes that do not have it. You can also type a new tag.
- After a change of a tag, the panel and the selection stay. Thus, you can change many tags in
  sequence. The other actions end the selection.
- The color panel marks the color that the selected notes share, if they share one.

These make a selection:

- The round checkbox at the top-left corner of a card. After that, a click anywhere on a card toggles
  it.
- A long press on touch devices.
- "Select all" in the selection bar.
- A box that you drag with the mouse from empty space in the grid. The app selects each card that the
  box touches, except auto-notes. "Select all" also skips auto-notes.
  - Shift or Cmd/Ctrl adds to the existing selection, and does not replace it.
  - If you hold the pointer at the top or bottom edge, the board scrolls.
  - Escape restores the selection from before the drag.

A click or a tap on empty space in the grid, without a drag, clears the selection. With Shift or
Cmd/Ctrl held, the selection stays.

## Sidebar

A navigation panel on the left, which you can collapse. It has links to:

- Notes (active, main view)
- Archive
- Trash
- The tag list, for filters

On mobile, a horizontal icon bar directly under the header replaces the sidebar.
