---
paths:
  - "packages/client/src/hooks/useMasonryGrid.ts"
  - "packages/client/src/hooks/useTouchGesture.ts"
  - "packages/client/src/components/NoteGrid.tsx"
  - "packages/client/src/components/ReorderableGrid.tsx"
  - "packages/client/src/hooks/useReorderDrag.ts"
  - "packages/client/src/hooks/useCardRoom.ts"
  - "packages/client/src/components/card/cardActionsFit.ts"
  - "packages/client/src/components/NoteSheet.tsx"
  - "packages/client/src/components/editor/NoteEditorToolbar.tsx"
  - "packages/client/src/state/ordering.ts"
  - "packages/client/src/splash.ts"
  - "packages/client/src/utils/phoneSheets.ts"
  - "packages/client/src/utils/edgeScroll.ts"
  - "packages/client/src/utils/morph.ts"
  - "packages/client/src/hooks/useCardModal.ts"
  - "packages/client/src/hooks/useHeldHeight.ts"
  - "packages/client/src/storage/quota.ts"
  - "packages/client/src/styles.css"
  - "packages/client/src/styles/**"
  - "packages/client/index.html"
  - "packages/client/public/theme-init.js"
  - "packages/client/public/splash-brand.js"
---

# Layout and Loading

## Masonry

`hooks/useMasonryGrid.ts` makes a masonry layout with `grid-row` spans. It releases each card to its
natural height, measures it, and then writes each span back.

- It runs from a `ResizeObserver`. Thus, it writes only the spans that changed. A pass that changes
  nothing causes no new callback, and this prevents a loop.
- Only a change of the *width* of the container releases the full grid. A card that changed size is
  measured again in its position. The items are `items-start`, so the span of a card cannot change
  its height.
- The key of the effect is the note ids, not the note list. Thus, an auto-save does not set up the
  grid again.
- Content that settles after the first paint (images, fonts) must cause a new measurement. If not,
  the card keeps its first height.

## The buttons of a card

The row of buttons at the bottom of a card has no scroll. The buttons that do not fit go into the
`...` menu of the card, from the right end of the row, and the menu button always stays.

- All cards of one grid have one width. Thus, `useCardRoom` in `ReorderableGrid` measures the first
  card once (with `offsetWidth`, because a leaning card has a wider box), and gives it to the cards
  through `CardRoomContext`. No card measures itself.
- `overflowingActions` (`card/cardActionsFit.ts`) counts the buttons that fit from fixed sizes. If
  you change `iconButtonClass`, the padding of a card or the gap of the row, change its constants.
- A popover whose button is not on the row opens from the menu button.

## Reorder

The `canReorder` computed controls drag-to-reorder: the Notes view or the Auto-notes view, default
sort, no search, no modal. The same control applies to the keyboard method (`moveNoteBy`, one
position in the section of the card, bound to `Shift j` / `Shift k` and in the card menu). WCAG
requires a keyboard method for each drag.

- `reorderNotes` gives the dropped note the midpoint between its neighbors, and writes nothing else.
- `position` is a float in both drivers. Thus, a `POSITION_STEP` (1000) gap lasts for approximately
  fifty halvings. Then `renumberFrom` spreads all positions again.
- The neighbors come from the full number line, with archived and trashed notes. All notes share the
  line. A position selected only from the visible notes can be the same as a hidden note.
- In the manual sort, `id` decides ties.

## The drag preview

While you drag a card, `ReorderableGrid` shows the new order (`hooks/useReorderDrag.ts`):

- The card takes the position of the card under the pointer. A hit test on the drawn positions of the
  cards finds that card. The other cards slide (FLIP) to make space.
- The CSS `order` of each card shows the order. Never move DOM nodes, because a move of a node
  removes the pointer capture of a touch drag.
- The dragged card keeps its position with `visibility: hidden`. The only copy on the screen is under
  the pointer (the drag image of the browser, or `.note-drag-ghost` for a finger).
- The card that was just swapped is ignored until the pointer leaves it. If not, the two cards swap
  again and again under a pointer that does not move.
- A drop commits the order on the screen. It never applies a move that still waits for its frame.
- The code cancels `dragenter` and `dragover`. Cards move under the pointer. If no `dragover`
  occurred after the pointer entered a card, the browser refuses a drop onto that card.

## Touch holds

On a touch screen, you can start that drag only when you hold the card first. The order of events in
`hooks/useTouchGesture.ts` keeps the board scrollable:

- If a finger moves before the hold time is complete, it is a scroll. The gesture stops itself. The
  card is never picked up, dimmed or selected during the scroll.
- When you release a hold that did not move, select mode starts.
- Thus, `.note-draggable` has `touch-action: pan-y`, not `none`. But with only that, the browser can
  start a pan on the first move *after* the hold, and take the pointer stream. Thus, a held card
  cancels the scroll at its source: a non-passive `touchmove` listener calls `preventDefault` from
  the time when the hold fires. `touch-action` cannot say "pannable until held".
- `onHoldEnd` fires for each end of a hold, also for a `pointercancel` from the system. If not, a
  card that the OS took the touch from stays lifted, and nothing holds it.

## The loading screen

`index.html` has a loading screen and a blocking `/theme-init.js` before the bundle. Both must be on
the screen, or applied, before the bundle exists. When an app starts from a home screen, there is no
browser chrome to look at while it loads.

- `theme-init.js` does the same two reads of `manifesto:prefs` as `prefs.ts`, and writes the same
  `dark` class as `state/theme.ts`. It is a separate file, not an inline script, because the CSP of
  the page permits scripts only from `'self'`.
- The splash goes away when the first real screen is there, not on the first render, which is an
  empty board. `splash.ts` fades it after two conditions: `revealApp()` is called (notes loaded, the
  sign-in screen, a crash or a setup error), and the fonts for that screen have arrived. It also
  fades at `SPLASH_CAP_MS` after the start, in all cases.
- A timer removes it, and `transitionend` also removes it. The reason is that the event never comes
  in a background tab.

The markup of the splash is the usual app brand. A second blocking file, `splash-brand.js`, is
immediately after it. It draws the splash again from the branding meta tags:

- It shows the brand of the top bar (`HEADER_BRAND`): the logo and name of the instance, or those of
  the app with the name of the instance under them. It also shows the dark variant of each logo.
- Thus, it copies the rules of `config.ts` and `BrandLogo` by hand. When they change, change it too.
- It reads the meta tags, not the build values. Thus, it also follows a release bundle that a person
  edited.
- `launchImage.ts` draws from the splash after that script ran. Thus, it reads the variants and the
  lines from the markup (`data-light`, `data-dark`, `data-invert`, `data-secondary`), not from the
  config.

## Phone sheets

On a phone, an open note, the composer and the history of a note are in the layout *of the page*.
They are not fixed over it. They go through `NoteSheet`.

- `.app-shell` (the board) is `fixed` to the screen. Thus, the page scrolls the note, and the board
  stays under it.
- It is always fixed, not only while a sheet is open. A home-screen app on iOS blurs the area under
  the status bar only if a fixed or sticky bar is there. The header of the board, in the flow of a
  page that never scrolls, was not.
- It has the opaque background of the page. iOS takes the color of that area from the background of
  the fixed element itself. When the shell was transparent, iOS kept the color of the last bar that
  had one: the top bar of a note that was closed.
- With this arrangement only, iOS keeps the caret above the keyboard. It scrolls the page, and does
  not slide the visible area over a fixed sheet.

No code that sizes or places a sheet reads `visualViewport`, on purpose:

- When a sheet had the size of the visual viewport, a thin part of the note was missing (Safari in a
  tab reports it too short).
- Padding for the keyboard added empty space after the end.
- A top bar that followed the visual viewport was one frame late on each scroll.

The surface of a sheet has a minimum height of `100lvh`, not `100dvh`. `dvh` changes only after
the toolbars of the browser go, and the fixed board showed under a short note until it did.

The scroll at the edge of a drag (`utils/edgeScroll.ts`) is the exception. It measures its edges on
the visual viewport, because with the keyboard up the bottom of the window is under the keys.

When the keyboard is open in a Safari tab, iOS pans the page past the bottom of the layout, and
past the `fixed` layers. Thus, the background of the page shows there. `paintPage` gives it the
color of the open note.

The keyboard covers the bottom of the layout, and nothing follows it. Thus, on a phone the tools of
the editor are not there. `NoteEditor` mounts `NoteEditorToolbar` in the sticky top bar (`atTop`,
selected with `useMediaQuery(PHONE_QUERY)`), with undo and redo adjacent to the pin. Only on a wider
screen is the toolbar under the note. The viewport meta tag tells Chrome on Android
`interactive-widget=resizes-content`. Thus, in Chrome the keyboard makes the layout smaller. Safari
ignores it. Each element that must show over an open note belongs outside `.app-shell` (the dialogs,
toasts and banners of App are there).

## The sheet aside

On a wide screen, `NoteSheet` also gives its content a place adjacent to the panel. The `SheetAside`
context is an element to portal into. It is to the right of the panel, with the same height (the
comments of a note open there).

- It is inside the dialog. Thus, the focus trap includes it.
- When it is empty, it has no width, and the panel is alone in the center.
- It becomes wider when content arrives, and narrower when content goes (`.sheet-aside` in
  `styles/editor.css`). Thus, the panel slides and does not jump.
- The content uses `sheet-aside-panel`. `usePresence` with `SHEET_ASIDE_EXIT_MS` keeps it during its
  exit.
- To decide if you use it, call `useMediaQuery(SHEET_ASIDE_QUERY)`. The query must agree with the
  `max-lg:hidden` of the element.

## The open and close of a note

The editor panel of a note grows out of its card, and shrinks back onto it (`utils/morph.ts`,
`hooks/useCardModal.ts`). The panel is laid out at its final place from its first frame. The
animation draws it over a rectangle that moves in a straight line between the card and that place.
Only `transform` changes (and `opacity` for the composer, and the corners). Thus, the layout inside
the editor never changes.

- **Nothing fades on a card.** The panel is opaque, and at both ends it covers the card exactly.
  The card hides when the grow starts, and shows when the shrink ends (`note-morphed`, a full
  `clip-path`). Many small fades with different times made the open look unstable. The card hides
  with a clip, because its `opacity` has a transition, and an element with `visibility: hidden`
  cannot take the focus that goes back to it at the close.
- **Only `transform` moves.** Only `transform` and `opacity` run on the compositor in all browsers.
  A `clip-path` animation can need the main thread, which is busy while a note opens (the editor
  builds, the shared document arrives, images decode), and each long frame stopped the motion.
- **A container transform** (`morphFrames`). The panel moves and scales onto the rectangle, and
  clips its content to its own box (`overflow: clip` while a run lasts). Its content, the
  `.note-sheet-content` wrapper of `NoteSheet`, has the inverse scale. Thus, the window grows and
  slides, and the text keeps its size: the text of a card and of the editor have one size, and the
  title one place. A scale of the text (to 0.56 for a usual card) made it small at the start and
  large again. The clip resets the scroll of the panel, so the content also carries `scrollTop`.
- **The corners** have their own animation (`border-radius`, divided by the scale on each axis). An
  animation runs on the compositor only when all of its properties can.
- **The points of the path** (`pathPoints`). Between two keyframes, the scale and the inverse scale
  each change linearly, and their product is not exactly 1. The points are close enough that the
  scale changes by at most 6% between two of them, which keeps the text within 0.1% of its size.
  Points at an even distance were off by 0.8% near the card.
- **The wait for the text.** Milkdown builds its view after the first frame. The grow of a card waits
  until the editor reports its text (`onReady` of `NoteCardEditor`), for a maximum of
  `MORPH_READY_WAIT_MS`. A grow that started at once went to the empty panel first. That panel is
  centered lower than a card near the top of the board. Thus, the grow went down, and then back up.
  While it waits, the panel is transparent and the card stays, and the two change places when the
  grow starts. When the panel covered the card during the wait, the card changed its look at the
  click, before anything moved.
- **Size changes.** `keepAimed` watches the panel. During a run, a new size starts a new line from
  where the panel is drawn now, at the current progress. With the old start and only a new end, the
  panel jumped. For `MORPH_FOLLOW_MS` after the grow, a new size runs from the old layout to the new
  one (images, previews and the shared document arrive late). Not on a phone, where a taller sheet
  does not move what is on the screen. `settle` stops the watch, so a close is never aimed again.
- When the editor is built again (solo to collab), its text and the place of the formatting bar keep
  their height (`useHeldHeight` in `NoteEditor`). If not, the panel becomes short and tall again,
  and a grow follows it. The removal of the old content starts the hold: a `MutationObserver`
  reports it in a microtask before the paint, and the element gets the last height that a
  `ResizeObserver` recorded. A hold from the state of the editor came one render late, and a hold
  from the teardown of the old editor came after Preact had removed its content. An inert copy of
  the removed content also stays in its place, so the text does not blink. A new editor (a different
  identity, not only a present one) releases the hold and removes the copies. One removal can come
  as several mutation records, so the hook groups them by element first.
- The composer grows out of its pad with the same code. It fades in over its first part, because
  the pad does not hide at once.

## Storage quota

`storage/quota.ts` reports a refusal of browser storage, and nothing more. It has no reference to the
toast queue or the catalogue. Thus, `failures.ts` keeps the decision to tell the user. The app does
not try a refused write again, and does not roll it back. The signal keeps the change. Thus, the
session continues with a note that exists only in this tab.
