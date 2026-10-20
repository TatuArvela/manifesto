import type { AccountPrefs, CapabilitiesResponse } from "@manifesto/shared";
import { signal } from "@preact/signals";

/**
 * The preferences that the host of the connected server selected as its
 * defaults (`defaultPrefs` in `/api/v1/capabilities`, set by
 * `fetchCapabilities`), and if a person was signed in when they arrived. Null
 * until the server told, and always in open mode. Kept separate from
 * `prefs.ts`, which changes the page when it loads, and from `auth.ts`, which
 * tests mock. Thus, `fetchCapabilities` and `prefsSync.ts` can both set it.
 *
 * `prefs.ts` applies them immediately on a browser with no preferences of its
 * own and nobody signed in. `prefsSync.ts` gives one to each key that an
 * account never stored.
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
