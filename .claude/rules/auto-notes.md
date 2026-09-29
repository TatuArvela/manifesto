---
paths:
  - "packages/client/src/autoNotes/**"
  - "packages/client/public/autonotes-sandbox.html"
  - "packages/client/src/state/autoNote*.ts"
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
