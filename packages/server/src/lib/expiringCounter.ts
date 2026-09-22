/** One key's tally, as handed back to a caller. */
export interface CounterWindow {
  /** Hits counted in the window that is currently open. */
  count: number;
  /** When that window ends, in epoch milliseconds. */
  resetAt: number;
}

export interface ExpiringCounterOptions {
  /** Window length in milliseconds, the same for every key. */
  windowMs: number;
  /** Hard cap on live keys. Past it, keys are evicted oldest-first. */
  maxEntries: number;
}

export interface ExpiringCounter {
  /** Count one hit against `key` and return the window it landed in. */
  hit(key: string, now?: number): CounterWindow;
  /** The open window for `key`, or null if it has none. Counts nothing. */
  peek(key: string, now?: number): CounterWindow | null;
  /** Forget `key` entirely, so its next hit opens a fresh window. */
  clear(key: string): void;
  /** Live keys, for tests and for anyone sizing the cap. */
  readonly size: number;
}

/** Hits between sweeps. Walking on every hit made a burst quadratic. */
const SWEEP_EVERY = 1024;

/**
 * Counters that expire on a fixed window, in a map held to a hard cap.
 *
 * Sweeping expired keys bounds the map only while keys expire faster than
 * they are created, and it is the caller's traffic that sets the creation
 * rate: one new key per request grows the map for a whole window. So the cap
 * is the real bound and the sweep is only the cheap half of it.
 *
 * Every key here shares one `windowMs`, and a window is (re-)inserted when it
 * opens, so the map's insertion order is its expiry order. That is what makes
 * both halves cheap: the sweep stops at the first key that is still live, and
 * an eviction takes whatever sits at the front, which is always the key
 * closest to expiring anyway.
 *
 * Evicting does reset an evicted key's count, which partly bypasses whatever
 * limit is built on top. It is the right trade as long as the keyspace is
 * small enough that cycling keys until your own is pushed out costs more than
 * the handful of hits it buys back.
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
    // Expired keys first, so a live one is only dropped when the map is over
    // the cap on live keys alone.
    sweep(now);
    for (const key of entries.keys()) {
      if (entries.size <= opts.maxEntries) break;
      entries.delete(key);
    }
  };

  const open = (key: string, now: number): CounterWindow => {
    // Deleting before setting moves the key to the back of the map. Mutating
    // a stale entry in place would leave it where its old window put it, and
    // the order the sweep and the eviction both rely on would drift.
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
