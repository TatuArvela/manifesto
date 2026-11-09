import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { defined } from "#/test/defined.ts";
import {
  MORPH_MS,
  MORPH_READY_WAIT_MS,
  morphIn,
  morphOut,
  settle,
} from "./morph.ts";

let panel: HTMLElement | null = null;

function makePanel(): HTMLElement {
  panel = document.createElement("div");
  panel.style.cssText = "position:fixed;inset:0";
  // The content, which takes the inverse scale (`.note-sheet-content`).
  const content = document.createElement("div");
  content.style.height = "100%";
  panel.appendChild(content);
  document.body.appendChild(panel);
  return panel;
}

const card = { left: 16, top: 200, width: 164, height: 120 };

/**
 * The rectangle that a panel draws on the screen: its layout, moved and scaled
 * by its transform, and cut by the insets of its clip.
 */
function drawn(el: HTMLElement) {
  // The panel is moved and scaled onto the rectangle, and clips its content to
  // its own box. Thus, its box with the transform is what is drawn.
  const box = el.getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

/** The scale on each axis of the computed transform of an element. */
function scaleOf(el: Element): [number, number] {
  const matrix = new DOMMatrix(getComputedStyle(el).transform);
  return [matrix.a, matrix.d];
}

afterEach(() => {
  panel?.remove();
  panel = null;
});

// A scale of the text made it small at the start and large again, and on a
// phone it squashed it. Only the window that shows the text scales.
describe.each([
  ["on a phone", 375],
  ["on a wider screen", 1024],
])("%s", (_, width) => {
  it("keeps the text at its size, both ways", async () => {
    await page.viewport(width, 700);
    const el = makePanel();
    const content = defined(el.firstElementChild ?? undefined);
    const check = () => {
      for (const time of [0, 20, 60, 120, MORPH_MS - 1]) {
        for (const animation of [
          ...el.getAnimations(),
          ...content.getAnimations(),
        ]) {
          animation.pause();
          animation.currentTime = time;
        }
        const [px, py] = scaleOf(el);
        const [cx, cy] = scaleOf(content);
        expect(px * cx).toBeCloseTo(1, 2);
        expect(py * cy).toBeCloseTo(1, 2);
      }
    };
    morphIn(el, card, { opaque: true });
    expect(getComputedStyle(el).overflow).toBe("clip");
    check();

    void morphOut(el, card, { fade: false });
    check();
  });

  // The panel clips its content only while it runs.
  it("gives the panel its overflow back after the grow", async () => {
    await page.viewport(width, 700);
    const el = makePanel();
    morphIn(el, card, { opaque: true });
    defined(el.getAnimations()[0]).finish();
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    expect(el.style.overflow).toBe("");
  });
});

describe("on a wider screen", () => {
  // Images and previews arrive while the grow runs. A grow aimed at the first,
  // shorter panel jumped when the panel became taller, and so did one that
  // only got a new end.
  it("goes on from where it is when the panel becomes taller", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:200px";
    morphIn(el, card, { opaque: true });
    const motion = defined(el.getAnimations()[0]);
    motion.pause();
    motion.currentTime = 60;
    const before = drawn(el);

    el.style.height = "400px";
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    await new Promise((done) => requestAnimationFrame(() => done(null)));

    const after = drawn(el);
    expect(el.getAnimations()).toHaveLength(1);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
    expect(after.width).toBeCloseTo(before.width, 0);

    // And it still lands on the new layout.
    motion.currentTime = MORPH_MS - 1;
    expect(drawn(el).height).toBeGreaterThan(395);
  });

  // The card hides when the grow starts. Thus, the panel must cover it
  // exactly, with no fade.
  it("starts opaque exactly over the card", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:400px";
    morphIn(el, card, { opaque: true });
    const motion = defined(el.getAnimations()[0]);
    motion.pause();
    motion.currentTime = 0;
    const rect = drawn(el);
    expect(rect.left).toBeCloseTo(card.left, 0);
    expect(rect.top).toBeCloseTo(card.top, 0);
    expect(rect.width).toBeCloseTo(card.width, 0);
    expect(rect.height).toBeCloseTo(card.height, 0);
    expect(getComputedStyle(el).opacity).toBe("1");
  });

  // Milkdown builds its view after the first frame. A grow that started at
  // once went to the empty panel, and then to the full one.
  it("holds the grow over the card until its content is ready", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    let resolve = () => {};
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    let started = false;
    morphIn(el, card, { ready, onStart: () => (started = true) });
    const motion = defined(el.getAnimations()[0]);
    expect(motion.playState).toBe("paused");
    // The card stays until the grow moves, and the panel does not cover it:
    // the two change places only when the grow starts.
    expect(started).toBe(false);
    expect(el.style.opacity).toBe("0");

    resolve();
    await ready;
    expect(motion.playState).toBe("running");
    expect(started).toBe(true);
    // The wait is over. A panel that is not opaque still fades in with its
    // keyframes from here.
    expect(el.style.opacity).toBe("");
  });

  it("does not wait for its content for longer than the limit", async () => {
    vi.useFakeTimers();
    try {
      await page.viewport(1024, 700);
      const el = makePanel();
      morphIn(el, card, { ready: new Promise<void>(() => {}) });
      const motion = defined(el.getAnimations()[0]);
      expect(motion.playState).toBe("paused");

      vi.advanceTimersByTime(MORPH_READY_WAIT_MS);
      expect(motion.playState).toBe("running");
    } finally {
      vi.useRealTimers();
    }
  });

  // Images, previews and the shared document can arrive after the grow, and
  // the centered panel jumped at each one.
  it("animates a size change that comes after the grow", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:200px";
    morphIn(el, card, { opaque: true });
    defined(el.getAnimations()[0]).finish();
    await new Promise((done) => requestAnimationFrame(() => done(null)));

    el.style.height = "400px";
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    const follow = defined(el.getAnimations()[0]);
    follow.pause();
    follow.currentTime = 0;
    expect(drawn(el).height).toBeCloseTo(200, 0);
    follow.currentTime = MORPH_MS - 1;
    expect(drawn(el).height).toBeGreaterThan(395);
  });

  // The card and the panel change places at both ends. Thus, the panel has the
  // shadow of the card there, and its own shadow between.
  it("has the shadow of the card at both ends", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:400px;box-shadow:0 10px 15px -3px rgb(0 0 0 / 0.1)";
    const shadow = "rgb(255, 0, 0) 0px 3px 3px -2px";
    morphIn(el, card, { opaque: true, shadow });
    for (const animation of el.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
    expect(getComputedStyle(el).boxShadow).toContain("rgb(255, 0, 0)");
    for (const animation of el.getAnimations()) animation.finish();
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    expect(getComputedStyle(el).boxShadow).not.toContain("rgb(255, 0, 0)");

    void morphOut(el, card, { fade: false, shadow });
    for (const animation of el.getAnimations()) animation.finish();
    expect(getComputedStyle(el).boxShadow).toContain("rgb(255, 0, 0)");
  });

  // A close must never be aimed again at a panel that changes size.
  it("stops following the panel when it settles for a close", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:200px";
    morphIn(el, card, { opaque: true });
    settle(el);

    el.style.height = "400px";
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    expect(el.getAnimations()).toHaveLength(0);
  });
});
