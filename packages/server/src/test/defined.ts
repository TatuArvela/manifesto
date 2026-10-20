/**
 * `value`. The test fails if it is missing. Use it for an element that a test
 * uses after this, where `noUncheckedIndexedAccess` types it as possibly
 * undefined. An optional chain there would let a negative assertion
 * (`not.toBeNull()`) pass on nothing.
 */
export function defined<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`Expected a ${what}, got undefined`);
  return value;
}
