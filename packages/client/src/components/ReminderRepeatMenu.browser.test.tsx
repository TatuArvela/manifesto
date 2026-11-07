import type { ReminderRecurrence } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReminderRepeatMenu } from "./ReminderRepeatMenu.tsx";

let host: HTMLDivElement;
let chosen: ReminderRecurrence[];

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function rowButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>("[aria-haspopup]");
  if (!button) throw new Error("No repeat row");
  return button;
}

function options(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("[aria-pressed]")];
}

async function openMenu() {
  rowButton().click();
  await nextFrame();
}

beforeEach(() => {
  chosen = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  render(
    <ReminderRepeatMenu value="weekly" onChange={(r) => chosen.push(r)} />,
    host,
  );
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("the repeat menu of a reminder", () => {
  it("marks the current choice", async () => {
    await openMenu();
    expect(rowButton().getAttribute("aria-expanded")).toBe("true");
    const pressed = options().filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(pressed).toHaveLength(1);
  });

  it("closes on a choice, and gives focus back to the row", async () => {
    await openMenu();
    options()[1]?.click();
    await nextFrame();
    expect(chosen).toEqual(["daily"]);
    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe(rowButton());
  });

  it("closes on Escape", async () => {
    await openMenu();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextFrame();
    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe(rowButton());
  });

  it("closes on a press outside it", async () => {
    await openMenu();
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await nextFrame();
    expect(options()).toHaveLength(0);
    expect(chosen).toEqual([]);
  });
});
