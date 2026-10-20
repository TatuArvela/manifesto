/**
 * `value`. The test fails if it is missing. For an element that a test uses
 * after this, where `noUncheckedIndexedAccess` gives it a type that can be
 * undefined. An optional chain there would let a negative assertion
 * (`not.toBeNull()`) pass on nothing.
 */
export function defined<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`Expected a ${what}, got undefined`);
  return value;
}
