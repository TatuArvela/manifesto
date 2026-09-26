import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { MilkdownEditor } from "../components/MilkdownEditor.js";
import "../styles.css";

/**
 * A checklist row on a touch screen, where the handle and the X are drawn at
 * all times and at finger size, and a drag has only the finger to go by.
 */

type Cdp = { send: (method: string, params?: object) => Promise<unknown> };
const session = () => cdp() as unknown as Cdp;

let host: HTMLDivElement;
let markdown = "";

async function mount(content: string) {
  host = document.createElement("div");
  host.className = "p-8";
  document.body.appendChild(host);
  render(
    <MilkdownEditor
      content={content}
      onChange={(value) => {
        markdown = value;
      }}
    />,
    host,
  );
  await vi.waitFor(() =>
    expect(host.querySelectorAll("li[data-item-type=task]").length).toBe(
      content.split("\n").length,
    ),
  );
}

const rows = () => [
  ...host.querySelectorAll<HTMLElement>("li[data-item-type=task]"),
];
const centre = (el: Element) => {
  const rect = el.getBoundingClientRect();
  return rect.top + rect.height / 2;
};

beforeEach(async () => {
  markdown = "";
  await page.viewport(375, 700);
  await session().send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
});

afterEach(async () => {
  render(null, host);
  host.remove();
  await session().send("Emulation.setTouchEmulationEnabled", {
    enabled: false,
  });
});

describe("a checklist row on a touch screen", () => {
  it("centres the handle, the checkbox and the X on the first line", async () => {
    await mount("- [ ] Milk\n- [ ] Bread");
    expect(matchMedia("(hover: none)").matches).toBe(true);

    for (const row of rows()) {
      const text = row.querySelector(":scope > .task-item-content p");
      if (!text) throw new Error("no text");
      const style = getComputedStyle(text);
      const line =
        text.getBoundingClientRect().top + parseFloat(style.lineHeight) / 2;
      for (const control of [
        ":scope > .task-item-drag-handle",
        ":scope > label input",
        ":scope > .task-item-delete",
      ]) {
        const el = row.querySelector(control);
        if (!el) throw new Error(`no ${control}`);
        expect(Math.abs(centre(el) - line)).toBeLessThan(0.5);
      }
    }
  });

  it("keeps a drag from its handle away from the scroller", async () => {
    await mount("- [ ] Milk");
    const handle = rows()[0].querySelector(".task-item-drag-handle");
    if (!handle) throw new Error("no handle");
    expect(getComputedStyle(handle).touchAction).toBe("none");
  });

  it("shows the item under the finger, snapped to the level it would land on", async () => {
    await mount("- [ ] Milk\n- [ ] Bread");
    const [, bread] = rows();
    const handle = bread.querySelector(".task-item-drag-handle");
    if (!handle) throw new Error("no handle");
    const start = handle.getBoundingClientRect();
    const x = start.left + start.width / 2;
    const y = start.top + start.height / 2;
    const at = (dx: number) =>
      ({ pointerId: 7, bubbles: true, clientX: x + dx, clientY: y }) as const;

    handle.dispatchEvent(
      new PointerEvent("pointerdown", { ...at(0), button: 0 }),
    );
    document.dispatchEvent(new PointerEvent("pointermove", at(8)));
    const ghost = document.querySelector<HTMLElement>(".task-item-drag-ghost");
    expect(ghost?.textContent).toContain("Bread");
    const flat = parseFloat(ghost?.style.left ?? "");

    // One indent to the right: under Milk, one level in.
    document.dispatchEvent(new PointerEvent("pointermove", at(30)));
    const nested = parseFloat(ghost?.style.left ?? "");
    expect(nested).toBeGreaterThan(flat);

    document.dispatchEvent(new PointerEvent("pointerup", at(30)));
    expect(document.querySelector(".task-item-drag-ghost")).toBeNull();
    await vi.waitFor(() => expect(markdown).toMatch(/\n\s+- \[ \] Bread/));
  });
});
