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
 * Vitest decodes its defines again, and can then be deleted along with the
 * `setupFiles` entry in `vite.config.ts`.
 */
const globals = globalThis as unknown as Record<string, unknown>;

for (const key of ["__APP_NAME__", "__APP_VERSION__", "__APP_WELCOME__"]) {
  const value = globals[key];
  if (typeof value !== "string") continue;
  try {
    globals[key] = JSON.parse(value);
  } catch {
    // Already decoded: a bare string such as `Manifesto` is not JSON.
  }
}
