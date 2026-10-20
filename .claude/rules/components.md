---
paths:
  - "packages/client/src/components/**"
  - "packages/client/src/hooks/**"
---

# Component Patterns

## Editors

- **NoteEditor** gets all of its data from props (title, content, color, font, callbacks). The
  parent components (`NoteCardEditor`, `NoteInput`) own the state.
- **NoteCardEditor** wraps NoteEditor to edit existing notes. It controls the auto-save (500ms
  debounce) and the version history. Milkdown does the undo and redo.

## Dropdown

**Dropdown** is the generic popover pattern (for the color picker, the font picker, the kebab menu).
Its props are `open`, `onClose`, `trigger` and `children`.

- Its panel opens and closes on one CSS transition, not two animations. Thus, if a menu opens again
  during the fade, the transition reverses and does not start again. `@starting-style` gives the
  other end of the entry.
- The popover is `manual`. The component dismisses it (outside press, Escape), and hides it only
  after the exit animation is complete. If the browser hides it immediately, it goes out of the top
  layer during the fade, and only Chromium can transition `overlay`.
- The render calculates `leaving`. An effect never sets it. One frame that is not open and not
  leaving is `display: none`, and that cancels the exit.
- Card popovers (`CardPopover`) mount only while they are open. They get their exit from
  `usePresence`.
- The slide is a translation, never a scale. The browsers without anchor positioning put the panel
  at a position from a measured `getBoundingClientRect`, and a scaled box measures smaller than its
  final size.
- `Dropdown` sets `aria-expanded` on the button of its trigger. When a panel closes with focus
  inside, it gives focus back to that button.
- A `CardPopover` is portalled to the end of the page. Thus, it moves focus in after it is in
  position (to the option marked `aria-pressed` / `aria-checked`, or to the first control). It moves
  focus back to its anchor when it closes. Without this, the keyboard never reached it.
- In a picker, mark the current option with `aria-pressed`. A screen reader and this focus both
  read it.
- A `persistent` dropdown (the floating bar of the formatting toolbar) is a bar to work from. An
  outside press does not close it, and another dropdown that opens does not close it. Thus, a menu
  inside it (the table menu) can open, and the bar stays. Only its trigger and Escape close it.

## The note menu

**A note's menu** is one list, `noteMenuItems` in `card/noteMenuItems.tsx`. All surfaces render it
through `NoteMenu`. A surface adds its own rows (`before`). It does not make its own menu.

- Rows that are not used frequently go in a `submenu` item. `arrangeMenu` removes an empty submenu.
  When a submenu has only one row, `arrangeMenu` shows that row in its place (under `fullLabel`).
- Where the pointer can hover, a submenu opens adjacent to the panel (`MenuFlyout`). It is inside the
  box of the panel, because a `Dropdown` is in the top layer. On a touch screen, it opens in place of
  the rows. In both cases, it gets Escape before the panel.
- A `Dropdown` keeps `NoteMenu` mounted while it is closed. Thus, give it `open`. If you do not, it
  opens again inside a submenu.

## Confirmation

**Confirming a deletion** goes through the `confirmRequest` signal in `state/confirm.ts`.
`ConfirmDialogHost` shows it, one question at a time. A second question answers the first with "no".
It does not stack. Thus, the promise of a replaced prompt always settles, and no caller stays
incomplete. `confirmDeletion` is the guard for one note, and it obeys the preference. Bulk deletions
call `askConfirmation` directly, because they apply to many notes whatever the preference is.

## Escape

**Escape** goes through `hooks/useEscapeStack.ts` only. Never bind a `keydown` listener for it.

- One document listener gives a press to the layer that became active last. Thus, a new layer that
  you can dismiss only calls `useEscapeStack(active, close)`.
- If you bind your own listener, an old bug comes back: one press closed the picker *and* the
  editor under it.
- The order is by activation, not by nesting (Preact runs the effects of a child first). Thus, a
  layer must not become active in the same render as the layer that contains it.
- A tooltip registers with `passThrough`. Escape hides it, and also goes to the layer below. Thus,
  the tooltip never needs a second press.
- `Dropdown` closes its own panel. It does not let the Popover API do it, because Chromium does not
  do the light-dismiss when focus is inside ProseMirror.

## Shortcuts

**Single-key shortcuts** go through `hooks/useShortcut.ts` only, as Escape does. The dispatcher, not
the binding, decides when a key is not a shortcut (typing, an `aria-modal` layer, an open popover, a
modifier). Thus, a new binding only calls `useShortcut(key, run)`. The board keys and the `?` sheet
read one list, `BOARD_SHORTCUTS` in `hooks/useBoardShortcuts.ts`.

## Back

**Back** closes the newest `NoteSheet` through `hooks/useBackToClose.ts`.

- Each sheet pushes a history entry with the same address. When a different action closes the
  sheet, the sheet removes the entry with `history.back()`.
- An `onBack` that keeps the layer open (the drawing pad asks before it discards a drawing) returns
  `false`, and the entry is put back. Without this, the next Back removes the entry of the sheet
  below.
- `state/sheetHistory.ts` keeps the entries. The pushes of the router wait until that back is
  complete (`afterHistorySettles`). If not, the back goes from the push of the router.

## Other rules

- **`editingNoteId`** is the only thing that decides if the modal of a card is open. To close it,
  clear the signal. `useCardModal` of `NoteCard` plays the animation and removes the modal.
- **Text buttons** get their classes from `buttonClass(tone, size)` in `buttonClasses.ts`. Never
  write their own class string. If you do, the variants become different again (there were a dozen
  of them).
- **On the board itself**, all items that are not notes (the message of the empty board, the
  Auto-notes introduction, the search filters, the admin view) are on `boardCard` from
  `boardCard.ts`. Thus, they stay legible over a board picture or a busy texture, and the four look
  the same.
- **Tones on a note** come from `noteText` in `colors.ts` (`read`, `quiet`, `icon`). `colors.test.ts`
  measures them against all note colors in all shades. `quiet` is the palest possible text on a note.
  Thus, to make an item look less important (ticked, past), use a line through it or a position.
  Never use a paler step or an `opacity-*`. `boardCard` and `boardLabel` (the section headings of
  the board) are opaque for the same reason: on a translucent surface, a dark board makes grey text
  go below 4.5:1.
- **Targets** are 24 by 24 px or larger (WCAG 2.5.8). If a target looks smaller, it keeps its look
  and gets the size invisibly. Use an `after:absolute after:-inset-*` on a `relative` button. For a
  checkbox, put a `<label>` around it, with padding and the same negative margin.
- **Keyboard focus** is one ring for the full app, `:focus-visible` in `styles/setup.css`. A control
  that draws its own ring uses `outline-none` with a `ring`. That wins, because the default is in the
  base layer. If a control removes the outline and draws nothing, there is no visible focus.
- **Layers over the board** are the `layer-*` utilities in `styles/setup.css`. Never use a bare
  `z-[n]`. The confirmation and the toasts are the top two, because each sheet can show either of
  them. When a confirmation had a number below a nested sheet, it showed behind the dialog that
  asked for it.
- **Parts that open rarely** (Settings, the admin view, the share and public link dialogs, the
  drawing pad) load when they open the first time, through `hooks/useLazyModule.ts`, from an
  `import()` at module level in `App.tsx`. The editor has its own loader. See `editor.md`. If code
  that the board reaches imports one of them statically, it goes back into the entry chunk, and
  nothing fails to tell you. After you add one, check the chunk list of the build. If a fetch fails,
  the app closes what asked for it and shows `error.viewUnavailable`. The reason is that an open tab
  can stay open after a deploy removes its chunks.
