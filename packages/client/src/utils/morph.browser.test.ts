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

/** The plates that draw the shadow of a run, in their order before the panel. */
function plates(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-morph-plate]")];
}

/** Holds each animation of the page at `time`. */
function setAll(time: number) {
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = time;
  }
}

afterEach(() => {
  panel?.remove();
  panel = null;
  for (const plate of plates()) plate.remove();
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

    void morphOut(el, card);
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

  // Milkdown builds its view after the panel mounts. A grow that started at
  // once went to the empty panel, and then to the full one. A grow that was
  // built at once and held measured the panel two times.
  it("waits over the card until its content is ready, and only then measures", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    let resolve = () => {};
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    let started = false;
    morphIn(el, card, { ready, onStart: () => (started = true) });
    expect(el.getAnimations()).toHaveLength(0);
    // The card stays until the grow moves, and the panel does not cover it:
    // the two change places only when the grow starts.
    expect(started).toBe(false);
    expect(el.style.opacity).toBe("0");

    // Content arrives during the wait. The grow goes to the panel with it.
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:400px";
    resolve();
    await ready;
    const motion = defined(el.getAnimations()[0]);
    expect(motion.playState).toBe("running");
    expect(started).toBe(true);
    // The wait is over. A panel that is not opaque still fades in with its
    // keyframes from here.
    expect(el.style.opacity).toBe("");
    motion.pause();
    motion.currentTime = MORPH_MS;
    expect(drawn(el).height).toBeCloseTo(400, 0);
  });

  it("does not wait for its content for longer than the limit", async () => {
    vi.useFakeTimers();
    try {
      await page.viewport(1024, 700);
      const el = makePanel();
      morphIn(el, card, { ready: new Promise<void>(() => {}) });
      expect(el.getAnimations()).toHaveLength(0);

      vi.advanceTimersByTime(MORPH_READY_WAIT_MS);
      expect(defined(el.getAnimations()[0]).playState).toBe("running");
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

  // A close during the grow started from the layout of the panel. Thus, the
  // full editor showed for a frame, and then shrank.
  it("starts a close during the grow where the panel is drawn", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:400px";
    morphIn(el, card, { opaque: true });
    const grow = defined(el.getAnimations()[0]);
    grow.pause();
    grow.currentTime = 30;
    const before = drawn(el);

    void morphOut(el, card);
    const shrink = defined(el.getAnimations()[0]);
    shrink.pause();
    shrink.currentTime = 0;
    const after = drawn(el);
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.height).toBeCloseTo(before.height, 0);

    // And it still lands on the card.
    shrink.currentTime = MORPH_MS;
    expect(drawn(el).width).toBeCloseTo(card.width, 0);
  });

  // A grow that waits never showed, and the card is still there.
  it("ends a close during the wait at once, with nothing on the screen", async () => {
    vi.useFakeTimers();
    try {
      await page.viewport(1024, 700);
      const el = makePanel();
      let started = false;
      morphIn(el, card, {
        ready: new Promise<void>(() => {}),
        onStart: () => (started = true),
      });
      await morphOut(el, card);
      expect(el.getAnimations()).toHaveLength(0);
      expect(el.style.opacity).toBe("0");

      // The end of the wait does not start the cancelled grow.
      vi.advanceTimersByTime(MORPH_READY_WAIT_MS);
      expect(started).toBe(false);
      expect(el.style.opacity).toBe("0");
    } finally {
      vi.useRealTimers();
    }
  });

  // The card and the panel change places at both ends. Thus, the shadow of the
  // card is there at both ends, and the shadow of the panel between. Plates
  // under the panel draw it, and move on the compositor.
  it("has the shadow of the card at both ends", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:400px;box-shadow:0 10px 15px -3px rgb(0 0 0 / 0.1)";
    const shadow = "rgb(255, 0, 0) 0px 3px 3px -2px";
    morphIn(el, card, { opaque: true, shadow });
    const [cardPlate, panelPlate] = plates();
    if (!cardPlate || !panelPlate) throw new Error("no plates");
    setAll(0);
    expect(getComputedStyle(cardPlate).boxShadow).toContain("rgb(255, 0, 0)");
    expect(getComputedStyle(cardPlate).opacity).toBe("1");
    expect(getComputedStyle(panelPlate).opacity).toBe("0");
    // On the card exactly, as the panel is.
    const box = cardPlate.getBoundingClientRect();
    expect(box.left).toBeCloseTo(card.left, 0);
    expect(box.width).toBeCloseTo(card.width, 0);
    // The panel does not draw its own shadow while the plates do.
    expect(getComputedStyle(el).boxShadow).toBe("none");

    for (const animation of document.getAnimations()) animation.finish();
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    expect(plates()).toHaveLength(0);
    expect(getComputedStyle(el).boxShadow).toContain("rgba(0, 0, 0, 0.1)");

    void morphOut(el, card, { shadow });
    const landing = plates().at(-1);
    for (const animation of document.getAnimations()) animation.finish();
    expect(getComputedStyle(defined(landing)).boxShadow).toContain(
      "rgb(255, 0, 0)",
    );
    expect(getComputedStyle(defined(landing)).opacity).toBe("1");
  });

  // A note with round corners: the window keeps them round on the screen,
  // with a clip, which runs on the compositor in Chromium.
  it("keeps round corners round, from the card to the panel", async () => {
    await page.viewport(1024, 700);
    document.documentElement.style.setProperty("--note-radius", "8px");
    try {
      const el = makePanel();
      el.style.cssText =
        "position:fixed;left:200px;top:100px;width:600px;height:400px;border-radius:8px";
      morphIn(el, card, { opaque: true });
      setAll(0);
      // The radius divided by the scale on each axis: 8 px on the screen.
      const [rx = 0, ry = 0] = (
        /round ([\d.]{1,20})px \/ ([\d.]{1,20})px/.exec(
          getComputedStyle(el).clipPath,
        ) ?? []
      )
        .slice(1)
        .map(Number);
      expect(rx).toBeCloseTo(8 / (card.width / 600), 1);
      expect(ry).toBeCloseTo(8 / (card.height / 400), 1);
    } finally {
      document.documentElement.style.removeProperty("--note-radius");
    }
  });

  it("takes its plates away when it settles", () => {
    const el = makePanel();
    el.style.boxShadow = "0 10px 15px -3px rgb(0 0 0 / 0.1)";
    morphIn(el, card, {
      opaque: true,
      shadow: "rgb(255, 0, 0) 0px 3px 3px -2px",
    });
    expect(plates().length).toBeGreaterThan(0);
    settle(el);
    expect(plates()).toHaveLength(0);
    // Its own shadow comes back, as it was before the run.
    expect(getComputedStyle(el).boxShadow).toContain("rgba(0, 0, 0, 0.1)");
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

  // A close during the grow started with the full shadow of the panel. The
  // shadow jumped at the press.
  it("starts a close during the grow with the shadow drawn there", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:400px;box-shadow:0 10px 15px -3px rgb(0 0 0 / 0.1)";
    const shadow = "rgb(255, 0, 0) 0px 3px 3px -2px";
    morphIn(el, card, { opaque: true, shadow });
    setAll(30);
    const grow = defined(el.getAnimations()[0]);
    const progress = grow.effect?.getComputedTiming().progress ?? 0;
    expect(progress).toBeGreaterThan(0);

    void morphOut(el, card, { shadow });
    setAll(0);
    const [panelPlate, cardPlate] = plates();
    if (!panelPlate || !cardPlate) throw new Error("no plates");
    expect(getComputedStyle(panelPlate).boxShadow).toContain(
      "rgba(0, 0, 0, 0.1)",
    );
    expect(Number(getComputedStyle(panelPlate).opacity)).toBeCloseTo(
      progress,
      2,
    );
    expect(Number(getComputedStyle(cardPlate).opacity)).toBeCloseTo(
      1 - progress,
      2,
    );
  });

  // The corners went to the own radius of the panel at the press: square on
  // a phone, and then round again.
  it("starts a close during the grow with the corners drawn there", async () => {
    await page.viewport(1024, 700);
    document.documentElement.style.setProperty("--note-radius", "8px");
    try {
      const el = makePanel();
      // Square corners, as the sheet of a phone has.
      el.style.cssText =
        "position:fixed;left:200px;top:100px;width:600px;height:400px";
      morphIn(el, card, { opaque: true });
      setAll(30);
      const radii = () =>
        (
          /round ([\d.]{1,20})px \/ ([\d.]{1,20})px/.exec(
            getComputedStyle(el).clipPath,
          ) ?? []
        )
          .slice(1)
          .map(Number);
      const [growX = 0, growY = 0] = radii();
      expect(growX).toBeGreaterThan(0);

      void morphOut(el, card);
      setAll(0);
      const [closeX = 0, closeY = 0] = radii();
      expect(closeX).toBeCloseTo(growX, 1);
      expect(closeY).toBeCloseTo(growY, 1);
    } finally {
      document.documentElement.style.removeProperty("--note-radius");
    }
  });

  // Each line that the reader typed after the grow started a run that clipped
  // the panel. Thus, the caret could not scroll into view.
  it("does not follow a size change after the reader typed", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:200px";
    morphIn(el, card, { opaque: true });
    defined(el.getAnimations()[0]).finish();
    await new Promise((done) => requestAnimationFrame(() => done(null)));

    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    el.style.height = "400px";
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    expect(el.getAnimations()).toHaveLength(0);
  });
});
