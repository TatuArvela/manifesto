import type { AccountPrefs, CapabilitiesResponse } from "@manifesto/shared";
import { signal } from "@preact/signals";

/**
 * The preferences the connected server's host chose as its defaults
 * (`defaultPrefs` in `/api/capabilities`, set by `fetchCapabilities`), with
 * whether someone was signed in when they arrived; null until the server has
 * said, and always in open mode. Kept apart from `prefs.ts`, which touches
 * the page as it loads, and from `auth.ts`, which tests mock, so that either
 * `fetchCapabilities` or `prefsSync.ts` can set it.
 *
 * `prefs.ts` applies them at once on a browser with no preferences of its
 * own and nobody signed in; `prefsSync.ts` gives one to each key an account
 * has never stored.
 */
export const serverDefaultPrefs = signal<{
  prefs: AccountPrefs;
  signedIn: boolean;
} | null>(null);

/** The defaults in a capabilities answer: an object, or none. */
export function defaultPrefsOf(
  capabilities: Partial<CapabilitiesResponse>,
): AccountPrefs {
  const defaults = capabilities.defaultPrefs;
  return defaults && typeof defaults === "object" && !Array.isArray(defaults)
    ? defaults
    : {};
}
