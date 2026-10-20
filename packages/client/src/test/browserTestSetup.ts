import { setOpenModeOwnerForTests } from "#/storage/offlineNotes.ts";
import { setSealingForTests } from "#/storage/sealing.ts";
import { plainSealing } from "./plainSealing.ts";

/**
 * The setup for only the `browser` test project.
 *
 * Vitest 5 copies `define` onto `globalThis` in browser mode without a decode.
 * Thus, `__APP_NAME__` arrives as `"\"Manifesto\""` in place of `"Manifesto"`.
 * Vite 6 hid this, because it changed the identifiers in the source. The dev
 * server of Vite 8 leaves them as globals, and the assignment of Vitest goes on
 * top of the correct assignment of Vite. The build and `pnpm dev` are not
 * affected.
 *
 * Only a value that is still JSON-encoded is decoded. Thus, this does nothing
 * after Vitest decodes its defines again, and you can then delete this loop.
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
 * Each test file runs in its own frame, but the frames share one origin, and
 * thus one `localStorage`. A write in one reaches the others as a `storage`
 * event. `prefs.ts` and `auth.ts` act on those as a change of a different tab.
 * Thus, a file that sets the locale to Finnish makes each file that runs next
 * to it Finnish during its tests. Only the own events of the browser come from
 * a different frame. A test that must simulate one constructs it, which is
 * untrusted. Thus, those still arrive. Registered before any module listens, in
 * the capture phase. Thus, it runs first.
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
 * servers that answer with readable notes. The seal has its own tests in the
 * node project. Thus, here notes go through as they are.
 */
setSealingForTests(plainSealing);

// What open mode keeps of drafts is in the IndexedDB that all files share.
setOpenModeOwnerForTests(`open-${crypto.randomUUID()}`);

/**
 * Each catalogue loads on demand, and the change to one waits for it. When the
 * catalogues load here, one time, a test that sets `locale` reads that language
 * immediately, as for a user whose catalogue is already here. Through
 * `messages/`, which imports nothing that a test mocks.
 */
const { loadCatalogue } = await import("#/i18n/messages/index.ts");
await loadCatalogue("fi");
