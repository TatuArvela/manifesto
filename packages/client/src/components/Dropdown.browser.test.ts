import { h, render } from "preact";
import { describe, expect, it } from "vitest";
import "../styles.css";
import { Dropdown } from "./Dropdown.js";

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
