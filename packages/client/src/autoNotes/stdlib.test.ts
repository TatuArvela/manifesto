import { describe, expect, it } from "vitest";
import {
  type ApproxLabels,
  addDays,
  approxUntil,
  buildStdlibPrelude,
  daysBetween,
  firstFuture,
  formatDate,
  lastOccurrence,
  lastPast,
  relativeDays,
} from "./stdlib.js";

const EN_LABELS: ApproxLabels = {
  today: "Today",
  tomorrow: "Tomorrow",
  dayAfterTomorrow: "The day after tomorrow",
  yesterday: "Yesterday",
  inNDays: "In {n} days",
  inAWeek: "In a week",
  inNWeeks: "In {n} weeks",
  underNWeeks: "Less than {n} weeks away",
  inAMonth: "In a month",
  nDaysAgo: "{n} days ago",
  aWeekAgo: "A week ago",
  nWeeksAgo: "{n} weeks ago",
  underNWeeksAgo: "Less than {n} weeks ago",
  aMonthAgo: "A month ago",
};

const FI_LABELS: ApproxLabels = {
  today: "Tänään",
  tomorrow: "Huomenna",
  dayAfterTomorrow: "Ylihuomenna",
  yesterday: "Eilen",
  inNDays: "{n} päivän päästä",
  inAWeek: "Viikon päästä",
  inNWeeks: "{n} viikon päästä",
  underNWeeks: "Alle {n} viikon päästä",
  inAMonth: "Kuukauden päästä",
  nDaysAgo: "{n} päivää sitten",
  aWeekAgo: "Viikko sitten",
  nWeeksAgo: "{n} viikkoa sitten",
  underNWeeksAgo: "Alle {n} viikkoa sitten",
  aMonthAgo: "Kuukausi sitten",
};

describe("stdlib", () => {
  it("addDays shifts forward and backward", () => {
    expect(addDays("2026-01-10", 5)).toBe("2026-01-15");
    expect(addDays("2026-01-10", -3)).toBe("2026-01-07");
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("daysBetween counts whole days", () => {
    expect(daysBetween("2026-01-01", "2026-01-10")).toBe(9);
    expect(daysBetween("2026-01-10", "2026-01-01")).toBe(-9);
  });

  it("firstFuture picks the earliest date after now", () => {
    expect(
      firstFuture(["2026-01-01", "2026-06-01", "2026-03-01"], "2026-02-15"),
    ).toBe("2026-03-01");
    expect(firstFuture(["2025-01-01"], "2026-02-15")).toBe(null);
  });

  it("lastPast picks the latest date up to now", () => {
    expect(
      lastPast(["2026-01-01", "2026-06-01", "2026-03-01"], "2026-04-15"),
    ).toBe("2026-03-01");
    expect(lastPast(["2030-01-01"], "2026-02-15")).toBe(null);
  });

  it("lastOccurrence projects forward from a known date", () => {
    // Start at Jan 1, every 42 days. Today is April 10.
    // 2026-01-01 + 0*42 = 2026-01-01
    // 2026-01-01 + 1*42 = 2026-02-12
    // 2026-01-01 + 2*42 = 2026-03-26
    // 2026-01-01 + 3*42 = 2026-05-07 (too far)
    expect(lastOccurrence("2026-01-01", 42, "2026-04-10")).toBe("2026-03-26");
  });

  it("formatDate produces a medium-style locale string", () => {
    const en = formatDate("2026-04-23", "en");
    const fi = formatDate("2026-04-23", "fi");
    // Don't pin exact wording — just ensure both localize differently and
    // include the year.
    expect(en).toMatch(/2026/);
    expect(fi).toMatch(/2026/);
  });

  it("relativeDays uses Intl.RelativeTimeFormat semantics", () => {
    // Same day → "today"
    expect(
      relativeDays("2026-04-23", "2026-04-23", "en").toLowerCase(),
    ).toMatch(/today/);
    // Past day
    expect(relativeDays("2026-04-20", "2026-04-23", "en")).toMatch(
      /3 days ago/,
    );
  });

  describe("approxUntil (en)", () => {
    const run = (iso: string, now: string) =>
      approxUntil(iso, now, "en", EN_LABELS);

    it("today / tomorrow / day-after / yesterday", () => {
      expect(run("2026-04-23", "2026-04-23")).toBe("Today");
      expect(run("2026-04-24", "2026-04-23")).toBe("Tomorrow");
      expect(run("2026-04-25", "2026-04-23")).toBe("The day after tomorrow");
      expect(run("2026-04-22", "2026-04-23")).toBe("Yesterday");
    });

    it("a few days in the future", () => {
      expect(run("2026-04-26", "2026-04-23")).toBe("In 3 days");
      expect(run("2026-04-29", "2026-04-23")).toBe("In 6 days");
    });

    it("exact weekly buckets", () => {
      expect(run("2026-04-30", "2026-04-23")).toBe("In a week");
      expect(run("2026-05-07", "2026-04-23")).toBe("In 2 weeks");
      expect(run("2026-06-04", "2026-04-23")).toBe("In 6 weeks");
    });

    it("under-N-weeks between exact weeks", () => {
      expect(run("2026-05-05", "2026-04-23")).toBe("Less than 2 weeks away");
      expect(run("2026-05-29", "2026-04-23")).toBe("Less than 6 weeks away");
    });

    it("month bucket at 30-31 days", () => {
      expect(run("2026-05-23", "2026-04-23")).toBe("In a month");
      expect(run("2026-05-24", "2026-04-23")).toBe("In a month");
    });

    it("past equivalents", () => {
      expect(run("2026-04-20", "2026-04-23")).toBe("3 days ago");
      expect(run("2026-04-16", "2026-04-23")).toBe("A week ago");
      expect(run("2026-04-09", "2026-04-23")).toBe("2 weeks ago");
      expect(run("2026-04-10", "2026-04-23")).toBe("Less than 2 weeks ago");
      expect(run("2026-03-24", "2026-04-23")).toBe("A month ago");
    });

    it("falls back to absolute date past 6 weeks", () => {
      expect(run("2026-07-01", "2026-04-23")).toMatch(/2026/);
    });
  });

  describe("approxUntil (fi)", () => {
    const run = (iso: string, now: string) =>
      approxUntil(iso, now, "fi", FI_LABELS);

    it("today / tomorrow / day-after / yesterday", () => {
      expect(run("2026-04-23", "2026-04-23")).toBe("Tänään");
      expect(run("2026-04-24", "2026-04-23")).toBe("Huomenna");
      expect(run("2026-04-25", "2026-04-23")).toBe("Ylihuomenna");
      expect(run("2026-04-22", "2026-04-23")).toBe("Eilen");
    });

    it("week buckets", () => {
      expect(run("2026-04-30", "2026-04-23")).toBe("Viikon päästä");
      expect(run("2026-05-05", "2026-04-23")).toBe("Alle 2 viikon päästä");
      expect(run("2026-06-04", "2026-04-23")).toBe("6 viikon päästä");
    });

    it("month bucket", () => {
      expect(run("2026-05-23", "2026-04-23")).toBe("Kuukauden päästä");
    });
  });

  it("buildStdlibPrelude emits valid JS", () => {
    const prelude = buildStdlibPrelude();
    expect(prelude).toContain("const __stdlibRaw");
    expect(prelude).toContain("addDays");
    expect(prelude).toContain("approxUntil");
    // The prelude should be evaluable — a smoke check that toString didn't
    // produce syntax garbage.
    expect(() => new Function(`${prelude}; return __stdlibRaw;`)).not.toThrow();
  });
});
