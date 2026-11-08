import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { defined } from "#/test/defined.ts";
import { MORPH_MS, morphClip, morphIn, morphOut } from "./morph.ts";

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

afterEach(() => {
  panel?.remove();
  panel = null;
});

describe("morphClip", () => {
  it("clips an element down to a rectangle inside it", () => {
    const to = { left: 0, top: 0, width: 375, height: 700 };
    expect(morphClip(card, to)).toMatch(
      /^inset\(200px 195px 380px 16px round /,
    );
  });

  it("clips nothing away from the element's own rectangle", () => {
    const to = { left: 0, top: 0, width: 375, height: 700 };
    expect(morphClip(to, to)).toMatch(/^inset\(0px 0px 0px 0px round /);
  });
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

  // The text of the editor arrives after the first frame, when the grow is
  // already a part of the way. A grow aimed at the first, shorter panel
  // jumped when the panel became taller, and so did one that only got a new
  // end.
  it("goes on from where it is when the panel becomes taller", async () => {
    await page.viewport(1024, 700);
    const el = makePanel();
    el.style.cssText =
      "position:fixed;left:200px;top:100px;width:600px;height:200px";
    morphIn(el, card);
    const motion = defined(el.getAnimations()[0]);
    motion.pause();
    motion.currentTime = 60;
    const before = el.getBoundingClientRect();

    el.style.height = "400px";
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    await new Promise((done) => requestAnimationFrame(() => done(null)));

    const after = el.getBoundingClientRect();
    expect(el.getAnimations()).toHaveLength(1);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
    expect(after.width).toBeCloseTo(before.width, 0);

    // And it still lands on the new layout.
    motion.currentTime = MORPH_MS - 1;
    expect(el.getBoundingClientRect().height).toBeGreaterThan(395);
  });
});
