import { describe, expect, it } from "vitest";
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
