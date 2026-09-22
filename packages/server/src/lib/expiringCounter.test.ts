import { describe, expect, it } from "vitest";
import { createExpiringCounter } from "./expiringCounter.js";

describe("createExpiringCounter", () => {
  it("adds up hits inside one window and starts a fresh one after it", () => {
    const counter = createExpiringCounter({ windowMs: 1000, maxEntries: 10 });
    expect(counter.hit("a", 0)).toEqual({ count: 1, resetAt: 1000 });
    expect(counter.hit("a", 999)).toEqual({ count: 2, resetAt: 1000 });
    expect(counter.hit("a", 1000)).toEqual({ count: 1, resetAt: 2000 });
  });

  it("keeps keys apart", () => {
    const counter = createExpiringCounter({ windowMs: 1000, maxEntries: 10 });
    counter.hit("a", 0);
    counter.hit("a", 0);
    expect(counter.hit("b", 0).count).toBe(1);
  });

  it("peeks without counting, and sees nothing once the window has passed", () => {
    const counter = createExpiringCounter({ windowMs: 1000, maxEntries: 10 });
    counter.hit("a", 0);
    expect(counter.peek("a", 500)?.count).toBe(1);
    expect(counter.peek("a", 500)?.count).toBe(1);
    expect(counter.peek("a", 1000)).toBeNull();
    expect(counter.peek("never-seen", 0)).toBeNull();
  });

  it("forgets a cleared key", () => {
    const counter = createExpiringCounter({ windowMs: 1000, maxEntries: 10 });
    counter.hit("a", 0);
    counter.hit("a", 0);
    counter.clear("a");
    expect(counter.peek("a", 0)).toBeNull();
    expect(counter.hit("a", 0).count).toBe(1);
  });

  it("hands back a copy, so a caller cannot edit the tally", () => {
    const counter = createExpiringCounter({ windowMs: 1000, maxEntries: 10 });
    counter.hit("a", 0).count = 99;
    expect(counter.peek("a", 0)?.count).toBe(1);
  });

  it("drops expired keys before live ones when it goes over the cap", () => {
    const counter = createExpiringCounter({ windowMs: 1000, maxEntries: 2 });
    counter.hit("stale", 0);
    counter.hit("live", 900);
    counter.hit("fresh", 1500);
    expect(counter.size).toBe(2);
    expect(counter.peek("stale", 1500)).toBeNull();
    expect(counter.peek("live", 1500)?.count).toBe(1);
  });

  it("drops the oldest live key when nothing has expired", () => {
    const counter = createExpiringCounter({ windowMs: 10_000, maxEntries: 2 });
    counter.hit("first", 0);
    counter.hit("second", 1);
    counter.hit("third", 2);
    expect(counter.size).toBe(2);
    expect(counter.peek("first", 2)).toBeNull();
    expect(counter.peek("second", 2)?.count).toBe(1);
    expect(counter.peek("third", 2)?.count).toBe(1);
  });

  it("restarts an expired window at the back, keeping expiry order", () => {
    const counter = createExpiringCounter({ windowMs: 100, maxEntries: 2 });
    counter.hit("a", 0);
    counter.hit("b", 50);
    // "a" opens a second window here, so it is now the newer of the two and
    // "b" is the one closest to expiring.
    counter.hit("a", 150);
    counter.hit("c", 160);
    expect(counter.peek("b", 160)).toBeNull();
    expect(counter.peek("a", 160)?.count).toBe(1);
    expect(counter.peek("c", 160)?.count).toBe(1);
  });

  it("holds the cap against a stream of keys nobody repeats", () => {
    const counter = createExpiringCounter({ windowMs: 60_000, maxEntries: 32 });
    for (let i = 0; i < 5000; i++) counter.hit(`key-${i}`, i);
    expect(counter.size).toBe(32);
    expect(counter.peek("key-4999", 5000)?.count).toBe(1);
  });
});
