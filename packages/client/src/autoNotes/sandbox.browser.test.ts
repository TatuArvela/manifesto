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

  it("times out a plugin that never returns, and rebuilds", async () => {
    // The plugin this exists for. Before plugins ran on their own thread
    // this test could not be written: the loop occupied the thread the host
    // timer needed, so the tab hung instead of timing out, and the test had
    // to fake a non-responsive plugin by throwing an object whose `.message`
    // getter threw.
    const spinSrc = `_default = () => { while (true) {} };`;
    await expect(runPlugin(spinSrc, CTX, 300)).rejects.toThrow(/timed out/);

    // A fresh invocation should still work — the sandbox was rebuilt, and
    // tearing down the frame took its spinning worker with it.
    const okSrc = `_default = () => ({ title: "ok", content: "still here" });`;
    const notes = await runPlugin(okSrc, CTX);
    expect(notes[0].title).toBe("ok");
  }, 10_000);

  it("leaves the host's event loop running while a plugin spins", async () => {
    const spinSrc = `_default = () => { while (true) {} };`;
    const ticks: number[] = [];
    const ticker = setInterval(() => ticks.push(Date.now()), 20);
    try {
      await expect(runPlugin(spinSrc, CTX, 300)).rejects.toThrow(/timed out/);
    } finally {
      clearInterval(ticker);
    }
    // A blocked main thread would have starved the interval entirely; the
    // timeout itself is the other half of the same evidence.
    expect(ticks.length).toBeGreaterThan(3);
  }, 10_000);

  it("drops a colour the plugin invented", async () => {
    // The host validates, so `noteColorMap[color]` can't be handed a string
    // it has no entry for — which threw while a card rendered.
    const src = `
      _default = () => ({ title: "t", content: "c", color: "hotpink" });
    `;
    const notes = await runPlugin(src, CTX);
    expect(notes[0].color).toBeUndefined();
  });

  it("keeps a note whose sibling fields are not serializable", async () => {
    // JSON on the wire rather than a structured clone: a function-valued
    // field would make `postMessage` throw a DataCloneError, which would
    // surface as a sandbox fault rather than as the plugin's own doing.
    const src = `
      _default = () => ({ title: "t", content: "c", render: () => 1 });
    `;
    const notes = await runPlugin(src, CTX);
    expect(notes[0].title).toBe("t");
  });

  it("refuses a run that returns more notes than the cap", async () => {
    const src = `
      _default = () => {
        const out = [];
        for (let i = 0; i < 500; i++) out.push({ title: "t", content: "c" });
        return out;
      };
    `;
    await expect(runPlugin(src, CTX)).rejects.toThrow(/the limit is 100/);
  });

  it("gives a plugin no window to reach the host through", async () => {
    // A worker has no `window` at all, and the frame that owns it has an
    // opaque origin, so the fallback path throws SecurityError here instead.
    const src = `
      _default = () => {
        const title = window.parent.document.title;
        return { title, content: "peeked" };
      };
    `;
    await expect(runPlugin(src, CTX)).rejects.toThrow();
  });

  it("has no access to host localStorage", async () => {
    // Unavailable in a worker; and denied to an opaque origin on the
    // fallback path, where `setItem` throws SecurityError.
    const src = `
      _default = () => {
        localStorage.setItem("pwned", "yes");
        return { title: "x", content: "y" };
      };
    `;
    await expect(runPlugin(src, CTX)).rejects.toThrow();
  });
});
