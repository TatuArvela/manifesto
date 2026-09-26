import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { trackVisualViewport } from "./visualViewport.js";
import "../styles.css";

const root = document.documentElement;
let stop: (() => void) | null = null;
let sheet: HTMLElement | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  sheet?.remove();
  sheet = null;
  root.style.removeProperty("--vv-top");
  root.style.removeProperty("--vv-height");
  root.classList.remove("keyboard-open");
});

describe("the visible area", () => {
  it("is published as it stands, with no keyboard up", async () => {
    await page.viewport(375, 700);
    stop = trackVisualViewport();
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("no visualViewport");
    expect(root.style.getPropertyValue("--vv-height")).toBe(
      `${viewport.height}px`,
    );
    expect(root.classList.contains("keyboard-open")).toBe(false);
  });

  it("is what a phone's sheet fills, keyboard or not", async () => {
    await page.viewport(375, 700);
    sheet = document.createElement("div");
    sheet.className = "phone-sheet fixed inset-0";
    document.body.appendChild(sheet);
    expect(sheet.getBoundingClientRect().height).toBe(700);

    // What the tracker writes with a keyboard taking the bottom 300px and
    // the page panned 40px to keep the caret in view.
    root.style.setProperty("--vv-top", "40px");
    root.style.setProperty("--vv-height", "400px");
    const rect = sheet.getBoundingClientRect();
    expect(rect.top).toBe(40);
    expect(rect.height).toBe(400);
  });

  it("leaves a wider screen's dialog where it was", async () => {
    await page.viewport(1024, 700);
    sheet = document.createElement("div");
    sheet.className = "phone-sheet fixed inset-0";
    document.body.appendChild(sheet);
    root.style.setProperty("--vv-top", "40px");
    root.style.setProperty("--vv-height", "400px");
    expect(sheet.getBoundingClientRect().top).toBe(0);
    expect(sheet.getBoundingClientRect().height).toBe(700);
  });
});
