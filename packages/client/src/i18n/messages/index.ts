import type { Locale } from "#/i18n/locales.js";
import { en } from "./en.js";

export type PluralEntry = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type MessageKey = keyof typeof en;

// Widen the narrow literal types from `as const` on the English source so
// translations can supply any string (or PluralEntry for plural keys) while
// still enforcing key parity.
export type Messages = {
  [K in keyof typeof en]: (typeof en)[K] extends string ? string : PluralEntry;
};

export { en };

/**
 * Every catalogue but English, each a chunk of its own, fetched only by
 * whoever reads that language. English is in the entry chunk, since it is the
 * default and what any missing string falls back to.
 */
export const catalogueLoaders: Record<
  Exclude<Locale, "en">,
  () => Promise<Messages>
> = {
  fi: () => import("./fi.js").then((m) => m.fi),
};

/**
 * The catalogues here so far. Held here rather than in `i18n/index.ts`, which
 * reads `config.js`: the browser tests' setup loads Finnish through this
 * module, and loading `config.js` there would come before, and so undo, the
 * mocks of it that tests in server mode make.
 */
export const catalogues: Partial<Record<Locale, Messages>> = { en };
const fetching = new Map<Locale, Promise<boolean>>();

/**
 * Fetches a language's catalogue if it is not here yet. Resolves false when
 * it could not be had (the next call tries again), and never rejects.
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
