import { h, render } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import "../styles.css";
import { Dropdown } from "./Dropdown.js";

describe("trigger", () => {
  /** A dropdown whose trigger toggles it, the way every caller wires one. */
  function Harness() {
    const [open, setOpen] = useState(false);
    return h(Dropdown, {
      open,
      onClose: () => setOpen(false),
      trigger: h(
        "button",
        { type: "button", onClick: () => setOpen(!open) },
        "more",
      ),
      children: h("span", null, "item"),
    });
  }

  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("closes an open panel when tapped, instead of reopening it", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(h(Harness, null), host);
    const trigger = host.querySelector("button") as HTMLButtonElement;
    const panel = host.querySelector(".dropdown-panel") as HTMLElement;

    trigger.click();
    await nextTask();
    expect(panel.matches(":popover-open")).toBe(true);

    // A tap in the order a phone delivers it: the pointer goes down on the
    // trigger, the browser light-dismisses the panel and the close renders,
    // and only then, as a separate gesture, does the click arrive.
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    panel.hidePopover();
    await nextTask();
    trigger.click();
    await nextTask();

    expect(panel.matches(":popover-open")).toBe(false);
    render(null, host);
    host.remove();
  });

  it("still opens a closed panel", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(h(Harness, null), host);
    const trigger = host.querySelector("button") as HTMLButtonElement;
    const panel = host.querySelector(".dropdown-panel") as HTMLElement;

    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    trigger.click();
    await nextTask();

    expect(panel.matches(":popover-open")).toBe(true);
    render(null, host);
    host.remove();
  });
});

// Real CSS, a real popover and a real computed style: the bug this covers
// lives in the cascade, not in any of our code.
describe("panel text colour", () => {
  /** Renders an open panel under `parent` and returns its computed colour. */
  const panelColor = (parentStyle: string, panelClass?: string): string => {
    const host = document.createElement("div");
    host.setAttribute("style", parentStyle);
    document.body.appendChild(host);
    render(
      h(Dropdown, {
        open: true,
        onClose: () => {},
        trigger: h("button", { type: "button" }, "trigger"),
        panelClass,
        children: h("span", null, "item"),
      }),
      host,
    );
    const panel = host.querySelector(".dropdown-panel");
    if (!panel) throw new Error("panel not rendered");
    const color = getComputedStyle(panel).color;
    render(null, host);
    host.remove();
    return color;
  };

  it("inherits the page colour when the panel names none", () => {
    // The UA stylesheet gives `[popover]` `color: CanvasText`, which beats
    // inheritance. Without our reset the panel would render black here, on
    // whatever dark background its own class list paints.
    expect(panelColor("color: rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
  });

  it("lets a panel that names a colour keep it", () => {
    // The header's menus are declared inside white-on-blue text and have to
    // override, so the reset must sit in a layer the utilities outrank.
    const reference = document.createElement("span");
    reference.className = "text-neutral-900";
    document.body.appendChild(reference);
    const expected = getComputedStyle(reference).color;
    reference.remove();

    expect(panelColor("color: rgb(1, 2, 3)", "text-neutral-900")).toBe(
      expected,
    );
  });
});

describe("closing", () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return h(
      "div",
      null,
      h(Dropdown, {
        open,
        onClose: () => setOpen(false),
        trigger: h(
          "button",
          { type: "button", onClick: () => setOpen(!open) },
          "more",
        ),
        children: h("span", null, "item"),
      }),
      h("p", { class: "outside" }, "elsewhere"),
    );
  }

  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("stays in the top layer while its exit plays, then leaves it", async () => {
    // Hiding the popover at once took the panel out of the top layer before
    // it had faded, which only Chromium could paper over.
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(h(Harness, null), host);
    await wait(50);
    const panel = host.querySelector(".dropdown-panel") as HTMLElement;
    expect(panel.matches(":popover-open")).toBe(true);

    host
      .querySelector(".outside")
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await wait(40);
    expect(panel.matches(":popover-open")).toBe(true);
    expect(panel.dataset.leaving).toBe("true");
    expect(getComputedStyle(panel).display).not.toBe("none");
    expect(Number(getComputedStyle(panel).opacity)).toBeLessThan(1);

    await wait(200);
    expect(panel.matches(":popover-open")).toBe(false);
    expect(panel.dataset.leaving).toBeUndefined();
    render(null, host);
    host.remove();
  });

  it("does not close on a press inside the panel", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(h(Harness, null), host);
    await wait(50);
    const panel = host.querySelector(".dropdown-panel") as HTMLElement;
    panel
      .querySelector("span")
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await wait(200);
    expect(panel.dataset.open).toBe("true");
    expect(panel.matches(":popover-open")).toBe(true);
    render(null, host);
    host.remove();
  });
});
