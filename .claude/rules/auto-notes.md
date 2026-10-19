---
paths:
  - "packages/client/src/autoNotes/**"
  - "packages/client/public/autonotes-sandbox.html"
  - "packages/client/src/state/autoNote*.ts"
  - "packages/client/src/utils/stripImages.ts"
---

# Auto-notes Plugin Sandbox

Auto-notes run JavaScript that the user supplies. Thus, the code runs at three levels of isolation
from the app. Each level is necessary:

- `public/autonotes-sandbox.html` loads through `iframe.src` with `sandbox="allow-scripts"` and no
  `allow-same-origin`. This gives an opaque origin, with no access to host storage, cookies or DOM.
  It cannot be `srcdoc`, because a `srcdoc` frame gets our `script-src 'self'`. A frame from a real
  URL has its own CSP.
- Inside the frame, the plugin runs in a blob `Worker` (thus `worker-src blob:` in that CSP). This
  makes the 2s timeout in `autoNotes/sandbox.ts` possible: a plugin that never returns uses only the
  thread of the worker. If an engine does not allow a worker at an opaque origin, the plugin runs on
  the thread of the frame. `init-ok` reports this, and the host shows a warning.
- The frame returns `JSON.stringify({ value })` and validates nothing. `autoNotes/results.ts`
  decides what is a note. Do not change this. A plugin that takes control of the frame also passes
  the checks of the frame.

A plugin can read notes. This is safe because the plugin has no output other than its cards.

- It asks for notes with `// @reads <tags>` in its header (`parse.ts`).
- It reads a tag only while the source asks for it and the user allows it (`grantedReads` in
  `registry.ts`).
- It gets `ctx.notes`, a frozen copy of the notes of the user. `notesFor` in `state/autoNotes.ts`
  makes the copy. The notes go to `initAutoNotes`, because `notesStore` imports this module.
- A tag includes the tags nested under it (`isTagWithin`).

Four things keep the notes that a plugin reads inside the sandbox:

- The CSP of the frame, and the worker: no connection and no navigation. `runPlugin` does not give
  notes to a plugin that runs on the thread of the frame, because that plugin can navigate the
  frame.
- A run that gets notes gets its own sandbox. The app destroys this sandbox when the run ends.
  Other runs share the worker. In a shared worker, a plugin can keep the notes on `self`, or change
  `__run` to catch the notes of the next plugin.
- `drawnWithoutImages` and `withoutImages` (`utils/stripImages.ts`). Each place that renders the
  content of a generated note must apply them. They are the second layer behind the
  `img-src 'self'` of the page, because a deployment can make that rule less strict. The decision
  comes from the run that made the card (`reading` on the rendered note), and also from the current
  plugin. Thus, Stop does not show the images again.
- `noteMenuItems` does not show Duplicate for such a card, because the copy is an ordinary note.

Be careful with these changes, because each one opens a way out again:

- A new renderer of auto-note content.
- A new way to change a generated note into an ordinary note.
- A new field on a generated note that fetches data (an image, a link preview).
