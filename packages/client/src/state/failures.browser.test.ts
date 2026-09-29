import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asBatch, type Batch, reportFailure } from "./failures.js";
import { locale } from "./prefs.js";
import { toasts } from "./ui.js";

/**
 * How note actions report what went wrong: one toast for one failed action,
 * one toast naming the total for a group, and never a rejection.
 */

const messages = () => toasts.value.map((t) => t.message);

beforeEach(() => {
  localStorage.clear();
  locale.value = "en";
  toasts.value = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  toasts.value = [];
  localStorage.clear();
});

/** An action as the store writes one: reports its failure, then resolves. */
async function action(ok: boolean, batch?: Batch): Promise<boolean> {
  await Promise.resolve();
  if (!ok) {
    reportFailure(
      "test action failed:",
      new Error("x"),
      "error.saveFailed",
      batch,
    );
  }
  return ok;
}

describe("reportFailure", () => {
  it("shows its own toast for an action on its own", async () => {
    await action(false);
    expect(toasts.value).toMatchObject([
      { type: "error", message: "Failed to save changes." },
    ]);
  });
});

describe("asBatch", () => {
  it("shows nothing when every action worked", async () => {
    const ok = await asBatch((batch) =>
      Promise.all([action(true, batch), action(true, batch)]),
    );
    expect(ok).toBe(true);
    expect(toasts.value).toEqual([]);
  });

  it("names the total once, rather than a toast per failure", async () => {
    const ok = await asBatch((batch) =>
      Promise.all([
        action(false, batch),
        action(true, batch),
        action(false, batch),
        action(false, batch),
      ]),
    );
    expect(ok).toBe(false);
    expect(messages()).toEqual(["3 notes could not be changed."]);
  });

  it("uses the singular for one", async () => {
    await asBatch((batch) => action(false, batch));
    expect(messages()).toEqual(["1 note could not be changed."]);
  });

  it("keeps two groups in flight at once apart", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const first = asBatch(async (batch) => {
      await firstGate;
      await action(false, batch);
    });
    const second = asBatch(async (batch) => {
      await Promise.all([action(false, batch), action(false, batch)]);
    });
    expect(await second).toBe(false);
    releaseFirst();
    expect(await first).toBe(false);
    expect(messages()).toEqual([
      "2 notes could not be changed.",
      "1 note could not be changed.",
    ]);
  });
});
