import { setOpenModeOwnerForTests } from "../storage/offlineNotes.js";
import { setSealingForTests } from "../storage/sealing.js";
import { plainSealing } from "./plainSealing.js";

/**
 * Setup for the `browser` test project only.
 *
 * Vitest 5 copies `define` onto `globalThis` in browser mode without decoding
 * it, so `__APP_NAME__` arrives as `"\"Manifesto\""` instead of `"Manifesto"`.
 * Vite 6 hid this by rewriting the identifiers in source; Vite 8's dev server
 * leaves them as globals, and Vitest's assignment lands on top of Vite's
 * correct one. The build and `pnpm dev` are unaffected.
 *
 * Only a value that is still JSON-encoded is decoded, so this goes quiet once
 * Vitest decodes its defines again, and this loop can then be deleted.
 */
const globals = globalThis as unknown as Record<string, unknown>;

for (const key of [
  "__APP_NAME__",
  "__APP_VERSION__",
  "__APP_WELCOME__",
  "__BRANDING__",
]) {
  const value = globals[key];
  if (typeof value !== "string") continue;
  try {
    globals[key] = JSON.parse(value);
  } catch {
    // Already decoded: a bare string such as `Manifesto` is not JSON.
  }
}

/**
 * Every test file runs in a frame of its own, but the frames share one origin
 * and so one `localStorage`, and a write in one reaches the others as a
 * `storage` event. `prefs.ts` and `auth.ts` act on those as another tab's
 * change, so a file that sets the locale to Finnish turns every file running
 * beside it Finnish mid-test. Only the browser's own events come from another
 * frame; a test that means to simulate one constructs it, which is untrusted,
 * so those still arrive. Registered before any module listens, in the capture
 * phase, so it runs first.
 */
window.addEventListener(
  "storage",
  (event) => {
    if (event.isTrusted) event.stopImmediatePropagation();
  },
  true,
);

/**
 * These tests are about the store, the socket and the screens, with fake
 * servers that answer in readable notes. Sealing has tests of its own in the
 * node project, so here notes pass through as they are.
 */
setSealingForTests(plainSealing);

// What open mode keeps of drafts lives in the IndexedDB every file shares.
setOpenModeOwnerForTests(`open-${crypto.randomUUID()}`);

/**
 * Every catalogue is fetched on demand, and the switch to one waits for it.
 * Fetched here, once, a test that sets `locale` reads that language at once,
 * as a user whose catalogue is already here does. Through `messages/`, which
 * imports nothing a test mocks.
 */
const { loadCatalogue } = await import("../i18n/messages/index.js");
await loadCatalogue("fi");
