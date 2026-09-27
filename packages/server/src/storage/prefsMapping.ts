import type { AccountPrefs } from "@manifesto/shared";
import { parseJson } from "./noteMapping.js";

/** The stored JSON as an object; anything else reads as none stored. */
export function parsePrefs(raw: string | null | undefined): AccountPrefs {
  const value = parseJson<unknown>(raw ?? null, {});
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AccountPrefs)
    : {};
}

/**
 * `current` with `patch` applied, `null` removing a key, and its JSON, or
 * `tooLarge` past `maxBytes`. Both drivers merge through this, so they agree
 * on what a patch does.
 */
export function mergePrefs(
  current: AccountPrefs,
  patch: AccountPrefs,
  maxBytes: number,
): { prefs: AccountPrefs; json: string } | "tooLarge" {
  const prefs: AccountPrefs = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete prefs[key];
    else prefs[key] = value;
  }
  const json = JSON.stringify(prefs);
  if (new TextEncoder().encode(json).length > maxBytes) return "tooLarge";
  return { prefs, json };
}
