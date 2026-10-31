---
paths:
  - "packages/client/src/components/drawing/**"
  - "packages/client/src/state/drawing.ts"
  - "packages/client/src/utils/drawing.ts"
  - "packages/client/src/utils/drawingLayers.ts"
  - "packages/client/src/utils/drawingRender.ts"
  - "packages/client/src/utils/penTip.ts"
  - "packages/client/src/utils/selection.ts"
  - "packages/client/src/utils/floodFill.ts"
  - "packages/client/src/utils/shapes.ts"
---

# The Drawing Pad

## Loading

- The pad loads only when it opens, through `useLazyModule` in `App.tsx` (see `components.md`). Code
  that the board reaches must not import a file of the pad or one of the `utils/` files above
  statically. If it does, the pad goes back into the entry chunk, and nothing fails to tell you.
- The editor asks for the pad through `requestDrawing` in `state/drawing.ts`. `App` renders the pad
  next to its other dialogs, not inside the editor. On a phone, a layer over an open note must be a
  sibling of the app shell.

## The model

The files in `utils/` know nothing about the pad. From the bottom up:

- `drawing.ts`: the paper, the marks (`Stroke`, `Shape`, `Fill`, `Clip`), boxes and transforms. Pure,
  with no canvas.
- `drawingLayers.ts`: layers, the sketch and its undo history. Pure. Each change makes a new sketch
  and keeps the old one, so undo and redo only move between sketches.
- `penTip.ts`: how a tip lays ink along the points of a stroke.
- `drawingRender.ts`: marks onto a canvas, and the canvas to an image file.
- `selection.ts`, `floodFill.ts`, `shapes.ts`: selected areas, fills and shape helpers.

Keep the direction: `drawing.ts` imports none of the others, and `drawingLayers.ts` imports no
canvas code. A type cycle between them was removed once; a mock in a cycle stops the browser project
with no error.

- A new kind of change is a new `Step`, with a name in both catalogues for the history list.
- A change that a slider repeats joins the last step through `joins` and `endJoin`. If not, one
  slide of an opacity is a hundred steps.
- `MAX_LAYERS` is 8. A picture opened on the pad is layer 0, named `picture`, under an empty layer 1.

## The pad

`DrawingPad.tsx` is the only file that connects the parts. Keep logic in the hooks, not in it.

- Types and constants that a hook and a component share go in a `.ts` file (`canvasBox.ts`,
  `pen.ts`, `tools.ts`), never in a `.tsx` component. A hook must not depend on the code that renders
  a panel.
- A canvas that ink is drawn on uses `CPU_INK`. On the GPU, Chrome changes the edge of a long path,
  and a line moves at the release.
- Use `reusedCanvas` for a canvas at the size of the picture. The canvas of a large photo holds tens
  of megabytes, and a phone has a limit for all of them together.
- Keys go through `padKeys.ts` (`useShortcut`), and Escape through `useEscapeStack`. A close that
  would discard a drawing asks first, through `useBackToClose`.
- In a browser test, await a frame between dependent events. Preact renders in a microtask.
