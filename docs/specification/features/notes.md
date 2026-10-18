# Notes

Notes are the core entity in Manifesto. A note is a card with a title, markdown content, and metadata.

## Creating a Note

A persistent "Take a note..." input bar sits at the top of the note grid. On focus, it expands to reveal separate title and content fields. Pressing Done (✓) creates the note, even an empty one. Closing any other way (Escape, clicking outside, the back arrow on phones) creates it only if it has a title, content, images or link previews, so opening the pad by accident leaves nothing behind. The discard button (✕) throws the draft away.

The draft is kept on the device as it is written, and comes back the next time the pad is opened, so a reload, a closed tab or a phone putting the app away loses nothing. Saving or discarding the note clears it. One draft is kept a device: two tabs writing at once keep whichever wrote last. A note shared to the installed app opens in the pad in its place, and a draft already kept is then saved as a note of its own.

A note can also be started from the board without opening the pad first:

- **Pasting** with nothing focused to type in and no note, dialog or menu open opens the pad with the clipboard in it: its text as the note's text (its links become preview cards as they would in the pad) and its pictures attached. A paste into a field or an open note is that field's.
- **Dropping pictures** anywhere on the window, with no note open, opens the pad with them attached; the drop zone says so while they are dragged over. Dropping anything else imports it, as before ([Export / Import](export-import.md)).

Either goes to the notes view if another is showing, and keeps a tag being looked at there. Pictures are shrunk and checked as an attached one is ([Attachments](attachments.md)).

In connected mode a new note is queued on the device before it is sent, so one written while the server cannot be reached is not lost. It is sent as soon as there is reason to think the server is back (the browser going online, the app reconnecting, the account being unlocked), under the id it was given when queued, so a note whose answer was lost is found rather than made twice. A note sent at once never shows as waiting; one that is not is listed above the board as waiting to be sent, where it can be taken back into the pad to be changed, or discarded. One the server refuses as it is (too long, say) is not sent again, and says so. These notes are not on the board until they land, since they are stored nowhere else yet.

Opening the pad peels its top sheet off first, and only once the sheet is free does the editor grow out of it. On a phone, where the pad is a floating + button, the editor grows out of the button.

New notes default to: color `default` (or the user's chosen default color, which may be random), font `default` (or user's chosen default), not pinned, not archived, not trashed, no tags.

## Editing a Note

Clicking a NoteCard opens the NoteEditor as a modal overlay, grown out of the card, and closing shrinks it back onto the card. A card that cannot be seen (scrolled away, or opened from a notification) fades in and out instead. With Settings > Appearance > Animations off, the editor simply appears. The editor provides:

- Title field (plain text)
- Content field: a rich markdown editor, with a raw mode that shows and edits the markdown source. Settings > Defaults > Default Edit Mode picks which one a note opens in. In connected mode raw edits reach collaborators as they are typed, and theirs appear in the textarea
- Links are edited as text: a click places the caret rather than following the link, and while the caret is in one, an "Open link" button under it (or Mod-Enter) opens it in a new tab. Only web and mail addresses are opened
- Formatting toolbar (headings, bold, italic, quotes, code, links, lists, checklists). In raw mode its buttons insert the markdown syntax instead. It can be hidden under Settings > Features, which hides it in every note
- Color picker
- Font picker, the "T" button (Default, Serif, Monospace, Permanent Marker, Comic Relief, Rouge Script); on a phone it lives in the kebab menu
- Tag button, opening the tag picker
- Kebab menu, in groups: the note's own tools (version history, Checklist), sending it
  somewhere (Share, Download, Duplicate), where it sits (Move, Archive), and Delete. Checklist, Share,
  Download and Move are submenus. With a mouse one opens beside the menu as the pointer rests on its
  row (or on a press, or the right arrow); on a touch screen it opens in place of the menu, behind a
  row back that Escape also takes. One left with a single row shows that row instead
- Toolbar with pin, archive, and undo/redo actions

On a phone the editor fills the screen, and its buttons, icons, title and text are a fifth larger than on a desktop. When the bottom toolbar does not fit on one row, its first two tools move to a row above, keeping the menu, undo/redo and Done within the thumb's reach.

Changes are saved on close (or debounced while editing).

## Board Background

Settings > Board Background is a page of its own, composing the area behind the notes in two sections, Color and Pattern, applied as it is chosen:

- **Color**: none (the page's own), white, gray or black (light to dark in either theme: black is a charcoal in the light theme and white a slate in the dark one, so the page's headings still read over them), a preset (red, orange, yellow, green, teal, blue, purple or pink, the hues of the note colours: a clear pastel a step stronger than a note of that colour in the light theme, and a step deeper in the dark), or a custom colour from the system picker. A custom colour is shown as picked in the light theme and mixed deep into the page colour in the dark one. **Random** puts a different preset on the board each visit; choosing it again rolls another.
- **Second Color**: none for a flat board, or a second colour the board fades to from the first, chosen the same way (a random one is never the first colour's preset). A board kept in one of the earlier muted presets (Sand, Sage, Mist, Blush, Lavender, Caramel) is read as the preset nearest it, and one in the earlier Cork, Felt or Linen pattern as Paper. Once one is set, **Direction** offers eight sides and corners on a compass, each drawn as the gradient it would make, with **Random** in its middle. A corner runs corner to corner on a board of any shape.
- **Pattern**: Plain, Paper, Dots, Grid, Lines, Confetti, Waves, Stars, Hearts, Bubbles, Stripes or Sawtooth (the logo in rows turned 45°, with a line between them barbed by its notches), drawn over the colour. They are CSS gradients and inline SVG, so no image files ship. **Random** puts a different pattern (never Plain) on the board each visit; choosing it again rolls another.
- **Pattern Color**: Gray (the default, offered between White and Black) draws every pattern in ink that follows the theme: black in light, white in dark. White, black, one of the eight presets in their vivid shade or a custom colour draws it in that colour in both themes. **Random** draws in a different preset each visit; choosing it again rolls another.
- **Pattern Opacity**: a slider from 0% to 100% (10% by default) for how opaque the pattern is. Every pattern is a mask over one layer that takes the pattern colour and this opacity, so every mark of every pattern, in every colour, is drawn at it (the paper grain, being noise, at up to it), and moving the slider or changing the colour redraws nothing. It is disabled while there is no pattern.
- **Picture**: one of the user's own, which covers the whole board in place of the colours and pattern. It is scaled to at most 2560px on its longest side and kept in IndexedDB on the device, under a thin scrim in the theme's colour so headings stay legible. Choosing a colour or pattern sets the picture aside without deleting it, and tapping its thumbnail brings it back.

The choices are per device and not synced, like the other preferences.

## Top Bar on Phones

On a narrow screen the top bar (the header and the row of view buttons under it) stays at the top of the screen while the board scrolls. Turning off Settings > Appearance > Keep Top Bar in View on Phones lets it scroll away with the board instead, giving the notes the whole screen; it comes back when the board is scrolled to the top, and while notes are selected, since the selection's actions live in it. Wider screens always keep it.

## Colors

Notes can be assigned a color from a predefined set (see `NoteColor` in [Data Model](../data-model.md)). Colors are displayed as the note card's background. Both light and dark theme variants are defined for every color.

## Pinning

Toggling the pin icon sets `pinned: true/false`. Pinned notes appear in a separate section at the top of the grid, labeled "Pinned." Unpinned notes appear below under "Others" (label only shown when pinned notes exist). A note being pinned goes to the head of the Pinned section; unpinning leaves its position alone.

## Ordering

Notes can be sorted in three modes, selectable from the header:

- **Default**: Manual drag-and-drop ordering. New notes go to the head of the board, newest first: a new note's `position` is minus its creation time, or a step ahead of the lowest position already held if that is lower still. The user can rearrange notes freely by dragging. The custom position is stored in the `position` field (see [Data Model](../data-model.md)).
- **Updated**: Last updated first.
- **Created**: Most recently created first.

Pinned and unpinned sections each maintain their own order independently. In default mode, each section has its own drag-and-drop sequence. While a note is dragged, the others move aside to show the order a drop would give: the note takes the place of the note under the pointer, and its own place in the preview is left empty, since the note is shown under the pointer (on a touch screen, a lifted copy that follows the finger). Holding the note near the top or bottom edge of the board scrolls it, for a finger as for a mouse. The whole card is what gets dragged: a link preview or image inside it is not dragged on its own, and a long press on one lifts the card rather than opening the system's link or image menu. Letting go outside the section puts everything back.

In connected mode, manual ordering is per-user: each user has their own arrangement.

## Grid and List Views

- **Grid view** (default): Responsive masonry-like grid. Notes have varying heights based on content (capped with overflow). The column count follows the window width, so a card stays about the same width and a bigger screen shows more notes rather than bigger ones. **Big notes** (the default) are about 250px wide, from one column on a phone up to ten on a very wide screen; **Small notes** are about 180px, from two up to fifteen. The choice is in the view menu, beside fit and square.
- **List view**: Single-column, full-width layout.

Toggled via a ViewToggle button in the header.

A note is written in an **ink** as well as a font: the theme's own text colour by default, or blue,
red, green or purple, picked beside the font in the editor (in its menu on a phone) and from a card's
font button. Everyone on a shared note sees the same ink, as they see the same font; the paper colour
is each person's own. See [NoteInk](../data-model.md#noteink).

A view with no notes in it shows a drawing of what it holds when it holds something, with a line
saying why it is empty and how a note gets there: a pad of blank notes on the Notes view, a tidy
archive box on the Archive, an emptied bin on the Trash (which also says how long it keeps a note),
a quiet alarm clock on Reminders, a blank tag for a tag with no notes, and a magnifying glass on
Search. The drawings are line work in the text colour, so they follow the theme, and a screen reader
skips them for the words. Notes kept out of the Notes view by a hidden tag are counted instead of
called none.

**Board Style** (Settings, Appearance, Notes, chosen from a small sample board of each) is **Tidy**
by default, every card level. On a **Messy**
board each card in the grid leans a degree or two, as real sticky notes do: between half a degree
and two either way, worked out from the note's id, so a note always leans the same way on every
device and reload. A card straightens while it is pointed at, focused or held. The list view stays
level, since its cards are as wide as the board and a degree there is a visible step at the edge.

## Selecting Notes

Selected notes can be pinned, tagged, recoloured, archived or deleted together from the header, which turns into a selection bar while anything is selected. Its tag panel lists every tag with a box that is checked when all of the selected notes carry the tag, dashed when only some do, and empty when none do: choosing a tag they all carry takes it from them, choosing any other gives it to the ones still missing it, and a new tag can be typed in. The panel and the selection stay as they are after a tag is changed, so several can be changed in a row; the other actions end the selection. The colour panel marks the colour the selected notes share, if they share one.

A selection is made by:

- the round checkbox at a card's top-left corner, which then toggles on click anywhere on the card
- a long press on touch devices
- "Select all" in the selection bar
- dragging a box with the mouse from empty space in the grid: every card the box touches is selected, except auto-notes, which "Select all" skips too. Shift or Cmd/Ctrl adds to the existing selection instead of replacing it, holding the pointer at the top or bottom edge scrolls, and Escape puts back the selection from before the drag

Clicking or tapping empty space in the grid, without dragging, clears the selection; with Shift or Cmd/Ctrl held it is kept.

## Sidebar

A collapsible navigation panel on the left with links to:

- Notes (active, main view)
- Archive
- Trash
- Tag list for filtering

On mobile, the sidebar is replaced by a horizontal icon bar directly under the header.
