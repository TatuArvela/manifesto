/**
 * A seeded source of random choices for the property tests, so a failing case
 * can be replayed: every property runs a fixed list of seeds, and a failure
 * names the seed it came from.
 *
 * Hand-written rather than a property-testing library: the tests here need a
 * few picks and shuffles, not shrinking, and a failure's seed plus the trace
 * the test prints is enough to read what went wrong.
 *
 * Not a `.test.ts` file, so Vitest does not collect it.
 */
export interface Random {
  /** An integer in `[0, n)`. */
  int(n: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Some of `items`, each kept with probability `p`, in their order. */
  subset<T>(items: readonly T[], p?: number): T[];
}

/** mulberry32: small, fast, and good enough to spread test cases. */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const random: Random = {
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    pick: (items) => items[random.int(items.length)] as (typeof items)[number],
    subset: (items, p = 0.5) => items.filter(() => random.chance(p)),
  };
  return random;
}

/** The seeds each property runs: enough to cover, few enough to stay quick. */
export const SEEDS: readonly number[] = Array.from(
  { length: 300 },
  (_, i) => i + 1,
);
