/** The count of one key, as a caller gets it. */
export interface CounterWindow {
  /** The hits counted in the window that is open now. */
  count: number;
  /** When that window ends, in epoch milliseconds. */
  resetAt: number;
}

export interface ExpiringCounterOptions {
  /** The window length in milliseconds, the same for all keys. */
  windowMs: number;
  /** The hard limit on live keys. After it, the oldest keys go first. */
  maxEntries: number;
}

export interface ExpiringCounter {
  /** Count one hit against `key`, and return its window. */
  hit(key: string, now?: number): CounterWindow;
  /** The open window for `key`, or null if it has none. Counts nothing. */
  peek(key: string, now?: number): CounterWindow | null;
  /** Forget `key` fully. Thus, its next hit opens a new window. */
  clear(key: string): void;
  /** The live keys, for tests and for a person who sets the limit. */
  readonly size: number;
}

/** Hits between sweeps. A walk on each hit made a burst quadratic. */
const SWEEP_EVERY = 1024;

/**
 * Counters that expire on a fixed window, in a map with a hard limit.
 *
 * A sweep of expired keys keeps the map small only while keys expire faster
 * than they are made. The traffic of the caller sets the rate at which keys are
 * made: one new key for each request grows the map for a full window. Thus, the
 * limit is the real bound, and the sweep is only the cheap half of it.
 *
 * All keys here share one `windowMs`. The code inserts a window (again) when it
 * opens. Thus, the insertion order of the map is its expiry order. This makes
 * both halves cheap. The sweep stops at the first key that is still live. An
 * eviction takes the key at the front, which is always the key nearest to
 * expiry.
 *
 * An eviction resets the count of the evicted key. That partly goes around the
 * limit that is built on top of it. This is the correct trade while the key
 * space is small. Then, to cycle keys until your own key goes out costs more
 * than the few hits that it gives back.
 */
export function createExpiringCounter(
  opts: ExpiringCounterOptions,
): ExpiringCounter {
  const entries = new Map<string, CounterWindow>();
  let sinceSweep = 0;

  const sweep = (now: number): void => {
    for (const [key, entry] of entries) {
      if (entry.resetAt > now) break;
      entries.delete(key);
    }
  };

  const evict = (now: number): void => {
    if (entries.size <= opts.maxEntries) return;
    // Expired keys first. Thus, the code removes a live key only when the live
    // keys alone are more than the limit.
    sweep(now);
    for (const key of entries.keys()) {
      if (entries.size <= opts.maxEntries) break;
      entries.delete(key);
    }
  };

  const open = (key: string, now: number): CounterWindow => {
    // A delete before the set moves the key to the back of the map. If the code
    // changed a stale entry in place, it would stay where its old window put
    // it. Then the order on which the sweep and the eviction both rely would
    // become incorrect.
    entries.delete(key);
    const entry: CounterWindow = { count: 0, resetAt: now + opts.windowMs };
    entries.set(key, entry);
    return entry;
  };

  return {
    hit(key, now = Date.now()) {
      if (++sinceSweep >= SWEEP_EVERY) {
        sinceSweep = 0;
        sweep(now);
      }
      const current = entries.get(key);
      const entry = current && current.resetAt > now ? current : open(key, now);
      entry.count += 1;
      evict(now);
      return { count: entry.count, resetAt: entry.resetAt };
    },
    peek(key, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry || entry.resetAt <= now) return null;
      return { count: entry.count, resetAt: entry.resetAt };
    },
    clear(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}
