import { h, render } from "preact";
import { describe, expect, it } from "vitest";
import "../styles.css";
import { computePanelPosition, Dropdown } from "./Dropdown.js";

const VIEWPORT = { width: 1000, height: 600 };
const PANEL = { width: 160, height: 200 };

/** A 100x30 trigger with its top-left at (x, y). */
const triggerAt = (x: number, y: number) => ({
  left: x,
  right: x + 100,
  top: y,
  bottom: y + 30,
});

describe("computePanelPosition", () => {
  it("opens below the trigger when there is room", () => {
    const { top } = computePanelPosition(
      triggerAt(200, 100),
      PANEL,
      VIEWPORT,
      "bottom-start",
    );
    // 4px gap under the trigger's bottom edge.
    expect(top).toBe(134);
  });

  it("flips above the trigger when the panel would overflow the bottom", () => {
    const trigger = triggerAt(200, 500);
    const { top } = computePanelPosition(
      trigger,
      PANEL,
      VIEWPORT,
      "bottom-start",
    );
    // Below would end at 534 + 200 = 734, past the 600px viewport, and there
    // is room above, so it sits 4px clear of the trigger's top edge.
    expect(top).toBe(500 - 200 - 4);
    expect(top + PANEL.height).toBeLessThanOrEqual(trigger.top);
  });

  it("flips below when a top-placed panel would overflow the top", () => {
    const { top } = computePanelPosition(
      triggerAt(200, 40),
      PANEL,
      VIEWPORT,
      "top-start",
    );
    expect(top).toBe(74);
  });

  it("does not flip when the opposite side has no room either", () => {
    // Trigger low down, but a panel too tall to fit above it.
    const tall = { width: 160, height: 480 };
    const { top } = computePanelPosition(
      triggerAt(200, 400),
      tall,
      VIEWPORT,
      "bottom-start",
    );
    // Clamped into view rather than flipped to an equally bad position.
    expect(top).toBe(VIEWPORT.height - tall.height - 4);
    expect(top).toBeGreaterThanOrEqual(4);
  });

  it("aligns the leading edge for -start and the trailing edge for -end", () => {
    const trigger = triggerAt(400, 100);
    expect(
      computePanelPosition(trigger, PANEL, VIEWPORT, "bottom-start").left,
    ).toBe(400);
    expect(
      computePanelPosition(trigger, PANEL, VIEWPORT, "bottom-end").left,
    ).toBe(trigger.right - PANEL.width);
  });

  it("keeps the panel inside the left and right edges", () => {
    expect(
      computePanelPosition(triggerAt(0, 100), PANEL, VIEWPORT, "bottom-end")
        .left,
    ).toBe(4);
    expect(
      computePanelPosition(triggerAt(960, 100), PANEL, VIEWPORT, "bottom-start")
        .left,
    ).toBe(VIEWPORT.width - PANEL.width - 4);
  });

  it("never returns a negative offset for a panel larger than the viewport", () => {
    const huge = { width: 1200, height: 900 };
    const { left, top } = computePanelPosition(
      triggerAt(100, 100),
      huge,
      VIEWPORT,
      "bottom-start",
    );
    expect(left).toBe(4);
    expect(top).toBe(4);
  });
});

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
    // inheritance — without our reset the panel would render black here, on
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
