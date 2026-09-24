import { afterEach, describe, expect, it, vi } from "vitest";
import { jobStatuses, startPeriodicJob } from "./periodic.js";

describe("job statuses", () => {
  it("records each run's outcome, and forgets a stopped job", async () => {
    let fail = false;
    const stop = startPeriodicJob("probe", 60_000, async () => {
      if (fail) throw new Error("disk full");
    });
    await new Promise((r) => setTimeout(r, 10));
    const status = jobStatuses().find((j) => j.name === "probe");
    expect(status).toMatchObject({
      intervalMs: 60_000,
      lastError: null,
      running: false,
    });
    expect(status?.lastFinishedAt).not.toBeNull();
    fail = true;
    stop();
    expect(jobStatuses().find((j) => j.name === "probe")).toBeUndefined();
  });

  it("keeps the last failure's message", async () => {
    const stop = startPeriodicJob("broken", 60_000, async () => {
      throw new Error("disk full");
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(jobStatuses().find((j) => j.name === "broken")?.lastError).toBe(
      "disk full",
    );
    stop();
  });
});

describe("intervals past the timer's limit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a monthly job once a month, not every millisecond", async () => {
    vi.useFakeTimers();
    const month = 30 * 24 * 60 * 60 * 1000;
    let runs = 0;
    const stop = startPeriodicJob("monthly", month, async () => {
      runs++;
    });
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(month - 1000);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(month);
    expect(runs).toBe(2);
    stop();
  });
});
