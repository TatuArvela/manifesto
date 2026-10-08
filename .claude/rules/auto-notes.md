---
paths:
  - "packages/client/src/autoNotes/**"
  - "packages/client/public/autonotes-sandbox.html"
  - "packages/client/src/state/autoNote*.ts"
  - "packages/client/src/utils/stripImages.ts"
---

# Auto-notes Plugin Sandbox

Auto-notes run user-supplied JavaScript, so it executes at three removes from the app and each
remove is load-bearing:

- `public/autonotes-sandbox.html` is loaded via `iframe.src` with `sandbox="allow-scripts"` and no
  `allow-same-origin`: an opaque origin, so no host storage, cookies or DOM. It can't be `srcdoc`:
  those inherit our `script-src 'self'`, while a frame from a real URL carries its own CSP.
- Inside the frame, the plugin runs in a blob `Worker` (hence `worker-src blob:` in that CSP). This
  is what makes the 2s timeout in `autoNotes/sandbox.ts` enforceable: a plugin that never returns
  occupies only the worker's thread. An engine that refuses a worker at an opaque origin gets a
  fallback to frame-thread execution, reported in `init-ok` and warned about by the host.
- The frame returns `JSON.stringify({ value })` and validates nothing; `autoNotes/results.ts`
  decides what is a note. Keep it that way, because a plugin that subverts the frame passes the frame's
  own checks.

A plugin can read notes, and the rule that makes that safe is that it has no way out but its cards.
It asks with `// @reads <tags>` in its header (`parse.ts`), reads a tag only while the source asks and
the user has allowed it (`grantedReads` in `registry.ts`), and gets `ctx.notes`, a frozen copy built by
`notesFor` in `state/autoNotes.ts` from the user's own notes (handed to `initAutoNotes`, since
`notesStore` imports this module). A tag covers the tags nested under it (`isTagWithin`). Four things
keep what it reads in:

- The frame's CSP and the worker: no connection, no navigation. `runPlugin` refuses to hand notes to a
  plugin running on the frame's own thread, where it could navigate the frame.
- A run handed notes gets a sandbox of its own, destroyed when it ends. The worker is otherwise shared,
  and a plugin can leave what it read on `self`, or patch `__run` to catch the next plugin's notes.
- `drawnWithoutImages` / `withoutImages` (`utils/stripImages.ts`), which every place that renders a
  generated note's content must apply. It is the second layer behind the page's `img-src 'self'`,
  which a deployment may loosen. The answer comes from the run that made the card (`reading` on the
  rendered note) as well as from the plugin now, so Stop does not bring the images back.
- `noteMenuItems` offers no Duplicate for such a card: the copy would be an ordinary note.

A new renderer of auto-note content, a new way to turn a generated note into an ordinary one, or a new
field on a generated note that fetches (an image, a link preview), reopens the way out.
