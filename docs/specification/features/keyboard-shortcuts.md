# Keyboard Shortcuts

The board answers single keys, as Google Keep, Joplin and Trilium do. `?` lists them in a sheet, which
Settings also links to.

| Key | Action |
|---|---|
| `c` | New note (switches to the notes view first) |
| `/` | Search |
| `j` / `k` | Focus the next / previous card |
| `Enter` | Open the focused card (a card's own behaviour, not a board shortcut) |
| `e` | Archive the focused card, or unarchive it in the archive |
| `#` | Move the focused card to the trash, asking first if "Confirm deletions" is on |
| `?` | Show the list |

Cards are walked in the order they are drawn: pinned first, then the rest, as filtered and sorted. When a
card leaves the board (`e`, `#`), focus moves to its neighbour so the next press has something to act on.

## When shortcuts are off

A single letter must never be taken from something that wants it, so shortcuts stand aside:

- while typing: focus in an input, a textarea, a select or anything editable, the note editor included;
- while a layer is up: any modal dialog (the editor, Settings, a confirmation, this sheet) or an open
  popover (a dropdown, a card menu);
- with Ctrl, Cmd or Alt held, so browser and system shortcuts keep working. Shift is allowed, because it
  is how `?` and `#` are typed.

## Implementation

Every shortcut goes through `hooks/useShortcut.ts`: one document listener, with the checks above made
once, in the dispatcher rather than in each binding. A key bound twice goes to the binding made last. The
board's bindings live in `hooks/useBoardShortcuts.ts`, which also exports the list the sheet renders, so
the sheet cannot fall behind what is bound. Escape is not part of this; it has its own stack
(`useEscapeStack`).
