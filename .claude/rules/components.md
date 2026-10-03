---
paths:
  - "packages/client/src/components/**"
  - "packages/client/src/hooks/**"
---

# Component Patterns

- **NoteEditor** is fully prop-driven (title, content, color, font, callbacks). Parent components (`NoteCardEditor`, `NoteInput`) own the state.
- **NoteCardEditor** wraps NoteEditor for editing existing notes and manages auto-save (500ms debounce) and version history. Undo/redo is delegated to Milkdown.
- **Dropdown** is the generic popover pattern (used for color picker, font picker, kebab menu) with
  `open`/`onClose`/`trigger`/`children` props. Its panel opens and closes on one CSS transition
  rather than two animations, so a menu re-opened mid-fade reverses instead of starting over, and
  `@starting-style` supplies the entry's other end. The popover is `manual`: the component
  dismisses it (outside press, Escape) and hides it only once the exit has played, since a browser
  that hides it at once takes it out of the top layer mid-fade and only Chromium can transition
  `overlay`. `leaving` is derived in render, never set by an effect: one frame of neither open nor
  leaving is `display: none`, which cancels the exit. Card popovers (`CardPopover`) are mounted
  only while open and get their exit from `usePresence`. The slide is a
  translation and never a scale, because the browsers without anchor positioning place the panel
  from a measured `getBoundingClientRect` and a scaled box measures smaller than it lands.
- **Confirming a deletion** goes through the `confirmRequest` signal in `state/confirm.ts`, which
  `ConfirmDialogHost` renders, one question at a time: a second question answers the first with
  "no" rather than stacking, so the promise behind a replaced prompt always settles and no caller
  is left half-done. `confirmDeletion` is the guard for a single note and respects the preference;
  bulk deletions call `askConfirmation` directly, since they take many notes whatever it says.
- **Escape** goes through `hooks/useEscapeStack.ts` and nowhere else; never bind a `keydown`
  listener for it. One document listener hands a press to the layer that became active last, so a
  new dismissable layer only has to call `useEscapeStack(active, close)`; binding your own brings
  back the bug where one press closed the picker *and* the editor under it. Ordering is by
  activation, not nesting (Preact runs a child's effects first), so a layer must not become active
  in the same render as one it sits inside. `Dropdown` closes its own panel rather than leaving it
  to the Popover API, because Chromium skips the light-dismiss when focus is inside ProseMirror.
- **Single-key shortcuts** go through `hooks/useShortcut.ts` and nowhere else, like Escape. The
  dispatcher, not the binding, decides when a key is not a shortcut (typing, an `aria-modal` layer or
  open popover, a modifier), so a new binding only calls `useShortcut(key, run)`. The board's keys and
  the `?` sheet read one list, `BOARD_SHORTCUTS` in `hooks/useBoardShortcuts.ts`.
- **Back** closes the newest `NoteSheet` through `hooks/useBackToClose.ts`: each sheet pushes a
  same-address history entry and takes it off with `history.back()` when closed another way. An
  `onBack` that keeps the layer open (the drawing pad, asking before a drawing is discarded) returns
  `false`, and its entry is put back; without that the next Back pops the entry of the sheet below. The
  entries are kept in `state/sheetHistory.ts`, and the router's own pushes wait for that back to land
  (`afterHistorySettles`), or they would be what it goes back from.
- **`editingNoteId`** is the only thing that decides whether a card's modal is up. Closing means
  clearing the signal; `NoteCard`'s `useCardModal` plays the animation and takes the modal down.
