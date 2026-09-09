import { afterEach, describe, expect, it } from "vitest";
import { resetSandbox, runPlugin } from "./sandbox.js";
import type { ApproxLabels } from "./stdlib.js";

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

const CTX = {
  today: "2026-04-23",
  locale: "en",
  approxLabels: EN_LABELS,
};

describe("sandbox", () => {
  afterEach(() => {
    resetSandbox();
  });

  it("runs a trivial plugin and returns a note", async () => {
    const src = `
      const fn = (ctx) => ({ title: "Hi", content: "hello " + ctx.today });
      _default = fn;
    `;
    const notes = await runPlugin(src, CTX);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Hi");
    expect(notes[0].content).toBe("hello 2026-04-23");
  });

  it("supports an array of plugin functions", async () => {
    const src = `
      _default = [
        () => ({ title: "A", content: "one" }),
        () => ({ title: "B", content: "two" }),
      ];
    `;
    const notes = await runPlugin(src, CTX);
    expect(notes).toHaveLength(2);
    expect(notes[0].title).toBe("A");
    expect(notes[1].title).toBe("B");
  });

  it("exposes stdlib functions bound to the locale", async () => {
    const src = `
      _default = ({ today, stdlib }) => ({
        title: "relative",
        content: stdlib.approxUntil(stdlib.addDays(today, 1), today),
      });
    `;
    const notes = await runPlugin(src, CTX);
    expect(notes[0].content).toBe("Tomorrow");
  });

  it("surfaces plugin exceptions as rejected promises", async () => {
    const src = `
      _default = () => { throw new Error("boom"); };
    `;
    await expect(runPlugin(src, CTX)).rejects.toThrow(/boom/);
  });

  it("rejects notes with missing required fields", async () => {
    const src = `
      _default = () => ({ color: "blue" });
    `;
    await expect(runPlugin(src, CTX)).rejects.toThrow(
      /string title and content/,
    );
  });

  it("rebuilds the sandbox after a timeout", async () => {
    // We simulate a non-responsive plugin by throwing an object whose
    // `.message` getter itself throws — this makes the sandbox's catch
    // handler throw before it can postMessage an error back to the host,
    // so no response ever arrives and the host timeout must fire.
    // (In browser-testing mode the iframe shares the main thread with the
    // parent, so a real while(true) would block the host's setTimeout.)
    const silentSrc = `
      _default = () => {
        const evil = {};
        Object.defineProperty(evil, "message", {
          get: function() { throw new Error("unreachable") }
        });
        throw evil;
      };
    `;
    await expect(runPlugin(silentSrc, CTX, 300)).rejects.toThrow(/timed out/);

    // A fresh invocation should still work — the sandbox was rebuilt.
    const okSrc = `_default = () => ({ title: "ok", content: "still here" });`;
    const notes = await runPlugin(okSrc, CTX);
    expect(notes[0].title).toBe("ok");
  }, 10_000);

  it("blocks access to window.parent DOM via opaque origin", async () => {
    // Reading cross-origin parent properties throws SecurityError.
    const src = `
      _default = () => {
        const title = window.parent.document.title;
        return { title, content: "peeked" };
      };
    `;
    await expect(runPlugin(src, CTX)).rejects.toThrow();
  });

  it("has no access to host localStorage", async () => {
    // Opaque-origin iframes can't persist to storage; localStorage.setItem
    // throws SecurityError.
    const src = `
      _default = () => {
        localStorage.setItem("pwned", "yes");
        return { title: "x", content: "y" };
      };
    `;
    await expect(runPlugin(src, CTX)).rejects.toThrow();
  });
});
