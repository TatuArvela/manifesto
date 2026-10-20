import type { Locale } from "#/i18n/locales.ts";
import { en } from "./en.ts";

export type PluralEntry = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type MessageKey = keyof typeof en;

// Widen the narrow literal types from `as const` on the English source. Thus,
// translations can give any string (or PluralEntry for plural keys), and the
// keys must still agree.
export type Messages = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? string : PluralEntry;
};

export { en };

/**
 * All catalogues other than English, each its own chunk, loaded only by users
 * who read that language. English is in the entry chunk, because it is the
 * default, and the fallback for each missing string.
 */
export const catalogueLoaders: Record<
  Exclude<Locale, "en">,
  () => Promise<Messages>
> = {
  fi: () => import("./fi.ts").then((m) => m.fi),
};

/**
 * The catalogues that are here now. They are kept here, not in `i18n/index.ts`,
 * which reads `config.js`. The setup of the browser tests loads Finnish through
 * this module. If it loaded `config.js` there, that would come before the mocks
 * of it that tests in server mode make, and would undo them.
 */
export const catalogues: Partial<Record<Locale, Messages>> = { en };
const fetching = new Map<Locale, Promise<boolean>>();

/**
 * Loads the catalogue of a language if it is not here yet. Resolves false when
 * it could not load (the next call tries again), and never rejects.
 */
export function loadCatalogue(loc: Locale): Promise<boolean> {
  if (loc === "en" || catalogues[loc]) return Promise.resolve(true);
  const pending = fetching.get(loc);
  if (pending) return pending;
  const load = catalogueLoaders[loc]().then(
    (catalogue) => {
      catalogues[loc] = catalogue;
      fetching.delete(loc);
      return true;
    },
    (err: unknown) => {
      console.warn("[i18n] could not load the %s catalogue", loc, err);
      fetching.delete(loc);
      return false;
    },
  );
  fetching.set(loc, load);
  return load;
}
