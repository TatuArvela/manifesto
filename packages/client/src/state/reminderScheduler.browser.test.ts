import { describe, expect, it } from "vitest";
import {
  formatLocalISO,
  nextOccurrence,
  parseLocalISO,
  snapToFuture,
} from "./reminderScheduler.js";

describe("parseLocalISO / formatLocalISO", () => {
  it("round-trips a local-wall-clock timestamp", () => {
    const iso = "2026-05-01T08:30:00";
    expect(formatLocalISO(parseLocalISO(iso))).toBe(iso);
  });

  it("pads single-digit components", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(formatLocalISO(d)).toBe("2026-01-02T03:04:05");
  });
});

describe("nextOccurrence", () => {
  it("returns null for recurrence 'none'", () => {
    expect(nextOccurrence("2026-05-01T08:00:00", "none")).toBeNull();
  });

  it("advances daily by +1 day", () => {
    expect(nextOccurrence("2026-05-01T08:00:00", "daily")).toBe(
      "2026-05-02T08:00:00",
    );
  });

  it("advances weekly by +7 days", () => {
    expect(nextOccurrence("2026-05-01T08:00:00", "weekly")).toBe(
      "2026-05-08T08:00:00",
    );
  });

  it("advances monthly by +1 month", () => {
    expect(nextOccurrence("2026-05-15T13:00:00", "monthly")).toBe(
      "2026-06-15T13:00:00",
    );
  });

  it("clamps monthly to the last day when target month is shorter", () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year).
    expect(nextOccurrence("2026-01-31T09:00:00", "monthly")).toBe(
      "2026-02-28T09:00:00",
    );
  });

  it("rolls month forward across year boundary", () => {
    expect(nextOccurrence("2026-12-20T18:00:00", "monthly")).toBe(
      "2027-01-20T18:00:00",
    );
  });

  it("advances yearly by +1 year", () => {
    expect(nextOccurrence("2026-03-05T20:00:00", "yearly")).toBe(
      "2027-03-05T20:00:00",
    );
  });

  it("falls Feb 29 back to Feb 28 on yearly in a non-leap year", () => {
    // 2024 is a leap year; 2025 is not.
    expect(nextOccurrence("2024-02-29T08:00:00", "yearly")).toBe(
      "2025-02-28T08:00:00",
    );
  });

  it("preserves local wall-clock hour across DST (daily)", () => {
    // Covers any local zone where DST transitions fall inside the advance:
    // since nextOccurrence uses local components, the hour stays stable.
    const result = nextOccurrence("2026-03-07T08:00:00", "daily");
    expect(result).toMatch(/T08:00:00$/);
  });
});

describe("snapToFuture", () => {
  it("is a no-op for recurrence 'none'", () => {
    const past = "2020-01-01T08:00:00";
    expect(snapToFuture(past, "none")).toBe(past);
  });

  it("is a no-op when time is already in the future", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const iso = formatLocalISO(future);
    expect(snapToFuture(iso, "daily")).toBe(iso);
  });

  it("advances past recurring times into the future", () => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const result = snapToFuture(formatLocalISO(oneWeekAgo), "daily");
    expect(parseLocalISO(result).getTime()).toBeGreaterThan(Date.now());
  });
});
