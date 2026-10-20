# Keyboard Shortcuts

The board accepts single keys, as Google Keep, Joplin and Trilium do. `?` shows a list of them in a
sheet. Settings also has a link to this sheet.

| Key | Action |
|---|---|
| `c` | New note (the app goes to the notes view first) |
| `/` | Search |
| `j` / `k` | Focus the next / previous card |
| `Shift j` / `Shift k` | Move the focused card one position later / earlier, in manual order |
| `Enter` | Open the focused card (this is the behavior of the card, not a board shortcut) |
| `e` | Archive the focused card, or unarchive it in the archive |
| `#` | Move the focused card to the trash. If "Confirm deletions" is on, the app asks first |
| `?` | Show the list |

The keys go through the cards in the order that the app draws them: pinned cards first, then the
other cards, filtered and sorted. When a card goes off the board (`e`, `#`), focus moves to the
adjacent card. Thus, the next key press has a card to act on.

To move a card with the keyboard is the same as to drag it. Thus, it works where dragging works
(`canReorder`: the notes view or the auto-notes view in manual order, with no search). The card
stays in its section, pinned or not. Focus stays on the moved card. A screen reader announces the
new position ("Moved to 3 of 10"). The card menu has the same function under "Move", and also "To
the start" and "To the end" of the section. These are for persons who do not use a pointer that can
drag, and do not use these keys. If the card can move in only one direction, the menu shows that one
row directly.

## When shortcuts are off

A shortcut must never take a letter from an element that needs it. Thus, shortcuts do not operate
in these conditions:

- While you type: focus is in an input, a textarea, a select or an editable element. This includes
  the note editor.
- While a layer is open: a modal dialog (the editor, Settings, a confirmation, this sheet) or an open
  popover (a dropdown, a card menu).
- While you hold Ctrl, Cmd or Alt. Thus, the browser and system shortcuts continue to work. Shift is
  permitted, because you use it to type `?` and `#`.

## Implementation

All shortcuts go through `hooks/useShortcut.ts`. It has one document listener. The dispatcher does
the checks above one time, not each binding. If two bindings use the same key, the last binding gets
the key. The board bindings are in `hooks/useBoardShortcuts.ts`. That file also exports the list
that the sheet shows. Thus, the sheet always agrees with the bindings. Escape is not part of this
system. It has its own stack (`useEscapeStack`).
