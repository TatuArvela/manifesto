import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { morphClip, morphIn, morphOut } from "./morph.js";

let panel: HTMLElement | null = null;

function makePanel(): HTMLElement {
  panel = document.createElement("div");
  panel.style.cssText = "position:fixed;inset:0";
  document.body.appendChild(panel);
  return panel;
}

const card = { left: 16, top: 200, width: 164, height: 120 };

/** What each keyframe of the panel's animations moves. */
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
  // Scaling the whole screen onto a card squashed the note's text.
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
});
