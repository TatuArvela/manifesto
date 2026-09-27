import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { openSheet, openSheetCount } from "./phoneSheets.js";
import "../styles.css";

/**
 * Real CSS in a real viewport: the point is where the browser lays things out
 * and what the page can scroll, which only computed layout shows.
 */

let shell: HTMLElement;
const made: HTMLElement[] = [];
const releases: (() => void)[] = [];

/** A sheet as `NoteSheet` draws one, `height` tall. */
function sheet(height: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "note-sheet z-50 sm:fixed sm:inset-0";
  const panel = document.createElement("div");
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
  shell.className = "app-shell relative h-dvh overflow-hidden";
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
    // The page is what scrolls a long note.
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

  it("puts the board back once the last sheet has gone", () => {
    const el = sheet(2000);
    const close = openSheet(el);
    close();
    el.remove();
    expect(getComputedStyle(shell).position).toBe("relative");
  });
});

describe("the page's background", () => {
  beforeEach(() => page.viewport(375, 700));

  const pageColour = () => getComputedStyle(document.body).backgroundColor;
  const surfaceOf = (el: HTMLElement) =>
    el.querySelector<HTMLElement>(".note-sheet-surface") as HTMLElement;

  // What iOS shows past the foot of the page with the keyboard up.
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

  it("leaves the dialog fixed over a board that stays put", () => {
    const el = sheet(300);
    open(el);
    expect(getComputedStyle(shell).position).toBe("relative");
    expect(getComputedStyle(el).position).toBe("fixed");
  });
});
