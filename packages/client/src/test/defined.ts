/**
 * `value`, failing the test if it is missing. For an element a test goes on to
 * use, where `noUncheckedIndexedAccess` types it as possibly undefined: an
 * optional chain there would let a negative assertion (`not.toBeNull()`) pass
 * on nothing at all.
 */
export function defined<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`Expected a ${what}, got undefined`);
  return value;
}
