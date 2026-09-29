---
paths:
  - "packages/client/src/hooks/useMasonryGrid.ts"
  - "packages/client/src/hooks/useTouchGesture.ts"
  - "packages/client/src/components/NoteGrid.tsx"
  - "packages/client/src/components/ReorderableGrid.tsx"
  - "packages/client/src/components/NoteSheet.tsx"
  - "packages/client/src/state/ordering.ts"
  - "packages/client/src/splash.ts"
  - "packages/client/src/utils/phoneSheets.ts"
  - "packages/client/src/utils/morph.ts"
  - "packages/client/src/storage/quota.ts"
  - "packages/client/src/styles.css"
  - "packages/client/src/styles/**"
  - "packages/client/index.html"
  - "packages/client/public/theme-init.js"
---

# Layout and Loading

`hooks/useMasonryGrid.ts` does masonry with `grid-row` spans: release every card to its natural
height, measure, then write each span back. It runs from a `ResizeObserver`, so it only writes
spans that changed. A pass that changes nothing provokes no further callback, which is what keeps
it from looping. Only a change of the container's *width* releases the whole grid; a card that
resized is re-measured where it stands (items are `items-start`, so its span cannot change its
height), and the effect is keyed on the note ids, not the note list, so an auto-save does not set
the grid up again. Content that settles after first paint (images, fonts) has to trigger a re-measure
or the card keeps the height it was born with.

Drag-to-reorder is gated by the `canReorder` computed: Notes or Auto-notes view, default sort, no
search, no modal. `reorderNotes` gives the dropped note the midpoint between its neighbours and
writes nothing else. `position` is a float in both drivers, so a `POSITION_STEP` (1000) gap lasts
about fifty halvings before `renumberFrom` spreads everything out again. The neighbours are found
on the whole number line, archived and trashed notes included: they share it, and a slot chosen
among the visible notes alone can land on a hidden one. Ties in the manual sort break on `id`.

While a card is dragged, `ReorderableGrid` previews the new order: the card takes the place of the
card under the pointer, found by hit-testing where cards are drawn, and the others slide (FLIP)
to make room. The order is shown through each card's CSS `order`, never by moving DOM nodes,
because moving a node drops the pointer capture a touch drag holds. The dragged card keeps its
slot with `visibility: hidden`; the only copy on screen is under the pointer (the browser's drag
image, or `.note-drag-ghost` for a finger). The card just swapped with is passed over until the
pointer leaves it, or the two swap back and forth under a still pointer. A drop commits the order
on screen and never applies a move still waiting for its frame. `dragenter` is cancelled as well
as `dragover`: cards move under the pointer, and a drop onto a card entered with no `dragover`
since is refused by the browser.

On a touch screen that drag is reached only by holding the card first, and the ordering in
`hooks/useTouchGesture.ts` is what keeps the board scrollable: a finger that moves before the hold
has elapsed is scrolling, so the gesture abandons itself and the card is never picked up, dimmed or
selected on the way past. Releasing a hold that never moved is what enters select mode.
`.note-draggable` therefore carries `touch-action: pan-y`, not `none`. That alone would let the
browser start a pan on the first move *after* the hold and take the pointer stream with it, so a
held card cancels the scroll at its source: a non-passive `touchmove` listener that
`preventDefault`s from the moment the hold fires. `touch-action` cannot express "pannable until
held". `onHoldEnd` fires however a hold ends, including a `pointercancel` the system sends, or a
card the OS took the touch from would stay lifted with nothing holding it.

`index.html` carries a loading screen and a blocking `/theme-init.js` ahead of the bundle, because
both have to be on screen or applied before the bundle exists: launched from a home screen there is
no browser chrome to look at while it loads. `theme-init.js` duplicates the two reads `prefs.ts`
makes of `manifesto:prefs` and writes the same `dark` class; it is a separate file rather than an
inline script because the page's CSP allows scripts from `'self'` only. The splash comes down
when the first real screen is there, not on the first render, which is an empty board: `splash.ts`
fades it once `revealApp()` is called (notes loaded, the sign-in screen, a crash or setup error)
and the fonts that screen asked for have arrived, or at `SPLASH_CAP_MS` after boot regardless. It
is removed on a timer as well as `transitionend`, since that event never arrives in a background
tab.

On a phone, an open note, the composer and a note's history are laid out *in the page*, not fixed
over it, and go through `NoteSheet`. `utils/phoneSheets.ts` pins `.app-shell` (the board) in place
while one is up, so the page scrolls the note. That is the one arrangement where iOS keeps the caret
above the keyboard by scrolling the page rather than sliding the visible area over a fixed sheet.
Nothing reads `visualViewport`, and that is deliberate: sizing a sheet to it left a sliver of note
(Safari in a tab reports it too short), padding for the keyboard added blank room past the end, and
a top bar moved to follow it trailed every scroll by a frame. With the keyboard up in a Safari tab,
iOS pans the page past the foot of everything laid out, `fixed` layers included, so the page's own
background shows there; `paintPage` gives it the open note's colour. Anything that
must show over an open note belongs outside `.app-shell` (App's dialogs, toasts and banners are).
The open and close morph uncovers the panel with `clip-path` there instead of scaling it
(`utils/morph.ts`), since a whole screen scaled onto a card squashes its text.

`storage/quota.ts` reports a browser storage refusal and nothing more: it holds no reference to the
toast queue or the catalogue, so the "tell the user" decision stays in `failures.ts`. A refused
write is neither retried nor rolled back: the signal keeps the change, so the session continues
with a note that exists only in this tab.
