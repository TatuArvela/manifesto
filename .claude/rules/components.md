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
  `Dropdown` sets `aria-expanded` on its trigger's button itself, and hands focus back to it when
  a panel closes with focus inside. A `CardPopover` is portalled to the end of the page, so it
  moves focus in once placed (to the option marked `aria-pressed` / `aria-checked`, else the first
  control) and back to its anchor on close; without that the keyboard never reached it. Mark the
  current option in a picker with `aria-pressed`, which both a screen reader and this focus read.
  A `persistent` dropdown (the formatting toolbar's floating bar) is a bar to work from: neither an
  outside press nor another dropdown opening closes it, so a menu inside it (the table's) can open
  without taking the bar down; only its trigger and Escape do.
- **A note's menu** is one list, `noteMenuItems` in `card/noteMenuItems.tsx`, which every surface renders
  through `NoteMenu`; a surface adds rows of its own (`before`) rather than a menu of its own.
  Rarer rows go in a `submenu` item, which `arrangeMenu` drops when empty and replaces with its row
  (under `fullLabel`) when that row is alone. A submenu opens beside the panel where the pointer can
  hover (`MenuFlyout`, placed inside the panel's box because a `Dropdown` is in the top layer) and in
  place of the rows on a touch screen; both take Escape before the panel does. A `Dropdown` keeps
  `NoteMenu` mounted while closed, so pass it `open` or it reopens inside a submenu.
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
  in the same render as one it sits inside. A tooltip registers with `passThrough`: Escape hides it
  and still reaches the layer below, so it never costs a second press. `Dropdown` closes its own panel rather than leaving it
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
- **Text buttons** take their classes from `buttonClass(tone, size)` in `buttonClasses.ts`, never a
  class string of their own, or the variants drift apart again (they had reached a dozen).
- **On the board itself**, anything that is not a note (the empty board's message, the Auto-notes
  introduction, the search filters, the admin view) sits on `boardCard` from `boardCard.ts`, so it
  stays legible over a board picture or a busy texture and the four look alike.
- **Tones on a note** come from `noteText` in `colors.ts` (`read`, `quiet`, `icon`), which
  `colors.test.ts` measures against every note colour in every shade. `quiet` is as pale as text
  on a note can go, so a dimmer look (ticked, past) is a line through or a position, never a paler
  step or an `opacity-*`. `boardCard` and `boardLabel` (the board's section headings) are opaque
  for the same reason: a translucent surface lets a dark board pull grey text under 4.5:1.
- **Keyboard focus** is one ring for the whole app, `:focus-visible` in `styles/setup.css`. A
  control that draws its own uses `outline-none` with a `ring`, which wins because the default sits
  in the base layer; one that removes the outline and draws nothing leaves no focus to see.
- **Layers over the board** are the `layer-*` utilities in `styles/setup.css`, never a bare
  `z-[n]`. The confirmation and the toasts are the top two, because any sheet can raise either:
  a confirmation numbered under a nested sheet was asked behind the dialog that asked it.
- **Rarely opened parts** (Settings, the admin view, the share and public link dialogs, the
  drawing pad) are fetched on first open through `hooks/useLazyModule.ts`, from a module-level
  `import()` in `App.tsx`. The editor has a loader of its own; see `editor.md`. A static import of either
  from anywhere the board reaches puts it back in the entry chunk, with nothing failing to say so;
  check the build's chunk list after adding one. A fetch that fails closes what asked for it and
  shows `error.viewUnavailable`, since an open tab can outlive a deploy's chunks.
