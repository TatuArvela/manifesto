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
  document.body.appendChild(panel);
  return panel;
}

const card = { left: 16, top: 200, width: 164, height: 120 };

/** What each keyframe of the animations of the panel moves. */
const animated = (el: HTMLElement) =>
  el
    .getAnimations()
    .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
    .flatMap((frame) => Object.keys(frame));

/**
 * The rectangle that a panel draws on the screen: its layout, moved and scaled
 * by its transform, and cut by the insets of its clip.
 */
function drawn(el: HTMLElement) {
  const style = getComputedStyle(el);
  const matrix = new DOMMatrix(style.transform);
  // One to four values, as in `margin`. The browser writes the shortest form.
  const values =
    (/^inset\(([^)]{0,200})\)/.exec(style.clipPath)?.[1] ?? "")
      .split(" round ")[0]
      ?.split(" ")
      .filter(Boolean)
      .map((value) => Number.parseFloat(value)) ?? [];
  const [top = 0, right = top, bottom = top, left = right] = values;
  const scale = matrix.a;
  // With the origin at the top left, the box of the transform starts at the
  // layout moved by the translation.
  const box = el.getBoundingClientRect();
  return {
    left: box.left + left * scale,
    top: box.top + top * scale,
    width: (el.offsetWidth - left - right) * scale,
    height: (el.offsetHeight - top - bottom) * scale,
  };
}

afterEach(() => {
  panel?.remove();
  panel = null;
});

describe("on a phone", () => {
  // A scale of the full screen onto a card squashed the text of the note.
  it("uncovers the editor rather than scaling it, both ways", async () => {
    await page.viewport(375, 700);
    const el = makePanel();
    morphIn(el, card);
    expect(animated(el)).toContain("clipPath");
    expect(animated(el)).not.toContain("transform");

    void morphOut(el, card);
    expect(animated(el)).toContain("clipPath");
    expect(animated(el)).not.toContain("transform");
  });
});

describe("on a wider screen", () => {
  it("still grows the editor out of the card", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    morphIn(el, card);
    expect(animated(el)).toContain("transform");
    expect(animated(el)).not.toContain("clipPath");
  });

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
    // The card stays until the grow moves. If not, nothing is on the screen.
    expect(started).toBe(false);

    resolve();
    await ready;
    expect(motion.playState).toBe("running");
    expect(started).toBe(true);
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
