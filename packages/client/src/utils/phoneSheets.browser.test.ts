import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { openSheet, openSheetCount } from "./phoneSheets.ts";
import "#/styles.css";

/**
 * Real CSS in a real viewport. The purpose is where the browser lays out
 * elements, and what the page can scroll, which only computed layout shows.
 */

let shell: HTMLElement;
const made: HTMLElement[] = [];
const releases: (() => void)[] = [];

/** A sheet as `NoteSheet` draws one, `height` tall. */
function sheet(height: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "note-sheet z-50 sm:fixed sm:inset-0";
  const panel = document.createElement("div");
  panel.className = "note-sheet-panel";
  const surface = document.createElement("div");
  surface.className = "note-sheet-surface bg-red-100";
  surface.style.height = `${height}px`;
  panel.appendChild(surface);
  el.appendChild(panel);
  document.body.appendChild(el);
  made.push(el);
  return el;
}

const open = (el: HTMLElement) => releases.push(openSheet(el));

beforeEach(() => {
  shell = document.createElement("div");
  shell.className = "app-shell overflow-hidden";
  document.body.prepend(shell);
});

afterEach(() => {
  for (const release of releases.splice(0).reverse()) release();
  for (const el of made.splice(0)) el.remove();
  shell.remove();
  window.scrollTo(0, 0);
  expect(openSheetCount()).toBe(0);
  expect(document.documentElement.classList.contains("sheet-open")).toBe(false);
});

describe("on a phone", () => {
  beforeEach(() => page.viewport(375, 700));

  it("lays the sheet out in the page, over a board pinned in place", () => {
    const el = sheet(2000);
    open(el);
    expect(getComputedStyle(shell).position).toBe("fixed");
    expect(getComputedStyle(el).position).toBe("relative");
    // The page scrolls a long note.
    window.scrollTo(0, 500);
    expect(window.scrollY).toBe(500);
    expect(shell.getBoundingClientRect().top).toBe(0);
  });

  it("fills the screen with a short note", () => {
    const el = sheet(100);
    open(el);
    expect(el.getBoundingClientRect().height).toBe(700);
  });

  it("pins a covered sheet and gives it its scroll back", () => {
    const lower = sheet(2000);
    open(lower);
    window.scrollTo(0, 400);

    const upper = sheet(300);
    const closeUpper = openSheet(upper);
    expect(getComputedStyle(lower).position).toBe("fixed");
    expect(window.scrollY).toBe(0);

    closeUpper();
    upper.remove();
    expect(getComputedStyle(lower).position).toBe("relative");
    expect(window.scrollY).toBe(400);
  });

  it("leaves the board where it was once the last sheet has gone", () => {
    const el = sheet(2000);
    const close = openSheet(el);
    close();
    el.remove();
    expect(getComputedStyle(shell).position).toBe("fixed");
    expect(shell.getBoundingClientRect().top).toBe(0);
  });
});

describe("keyboard focus under the sheet's bars", () => {
  beforeEach(() => page.viewport(375, 700));

  /** A long note with both bars, and a button `at` px down the note. */
  function barredSheet(at: number) {
    const el = sheet(3000);
    const surface = el.querySelector(".note-sheet-surface") as HTMLElement;
    const top = document.createElement("div");
    top.className = "note-sheet-top";
    top.style.height = "80px";
    // Where Tab starts: fixed between the bars. Thus, it needs no scroll.
    const before = document.createElement("button");
    before.textContent = "before";
    before.style.cssText = "position: fixed; top: 300px";
    const target = document.createElement("button");
    target.textContent = "target";
    target.style.cssText = `position: absolute; top: ${at}px; height: 24px`;
    const bottom = document.createElement("div");
    bottom.className = "note-sheet-bottom";
    bottom.style.cssText = "height: 60px; margin-top: 2800px";
    surface.style.position = "relative";
    surface.append(top, before, target, bottom);
    return { el, top, target, bottom, before };
  }

  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

  it("scrolls a control out from under the top bar", async () => {
    const { el, top, target, before } = barredSheet(600);
    open(el);
    window.scrollTo(0, 560);
    before.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(target);
    await nextFrame();
    await nextFrame();
    expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      top.getBoundingClientRect().bottom - 0.5,
    );
  });

  it("scrolls a control up from under the bottom bar", async () => {
    const { el, bottom, target, before } = barredSheet(640);
    open(el);
    window.scrollTo(0, 0);
    before.focus();
    await userEvent.tab();
    await nextFrame();
    await nextFrame();
    expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      bottom.getBoundingClientRect().top + 0.5,
    );
  });
});

describe("the page's background", () => {
  beforeEach(() => page.viewport(375, 700));

  const pageColour = () => getComputedStyle(document.body).backgroundColor;
  const surfaceOf = (el: HTMLElement) =>
    el.querySelector<HTMLElement>(".note-sheet-surface") as HTMLElement;

  // What iOS shows past the bottom of the page when the keyboard is up.
  it("takes the open note's colour, and follows a change of it", async () => {
    const before = pageColour();
    const el = sheet(100);
    open(el);
    expect(pageColour()).toBe(getComputedStyle(surfaceOf(el)).backgroundColor);

    surfaceOf(el).classList.replace("bg-red-100", "bg-yellow-100");
    // Mutation observers report after the current task.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pageColour()).toBe(getComputedStyle(surfaceOf(el)).backgroundColor);
    expect(pageColour()).not.toBe(before);
  });

  it("goes back to its own once the last sheet has gone", () => {
    const before = pageColour();
    const el = sheet(100);
    const close = openSheet(el);
    close();
    el.remove();
    expect(pageColour()).toBe(before);
  });
});

describe("on a wider screen", () => {
  beforeEach(() => page.viewport(1024, 700));

  it("leaves the dialog fixed over a board fixed in place", () => {
    const el = sheet(300);
    open(el);
    expect(getComputedStyle(shell).position).toBe("fixed");
    expect(getComputedStyle(el).position).toBe("fixed");
  });
});
