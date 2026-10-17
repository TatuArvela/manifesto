import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsRow } from "./settings/SettingsControls.tsx";
import { Switch, ThreeWayToggle } from "./ToggleSwitch.tsx";

const OPTIONS = [
  { icon: "a", label: "System" },
  { icon: "b", label: "Light" },
  { icon: "c", label: "Dark" },
];

let container: HTMLElement;

function mount(node: preact.JSX.Element) {
  container = document.createElement("div");
  document.body.append(container);
  render(node, container);
}

afterEach(() => {
  render(null, container);
  container.remove();
});

/** The name an `aria-labelledby` list resolves to, as a screen reader reads it. */
function labelledName(el: Element): string {
  return (el.getAttribute("aria-labelledby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("ThreeWayToggle", () => {
  it("is a radio group of real radios, one of them checked", () => {
    mount(
      <ThreeWayToggle
        value={1}
        onChange={() => {}}
        options={OPTIONS}
        label="Theme"
      />,
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-label")).toBe("Theme");
    const radios = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ];
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  });

  it("reports the option picked", () => {
    let picked = -1;
    mount(
      <ThreeWayToggle
        value={0}
        onChange={(i) => {
          picked = i;
        }}
        options={OPTIONS}
        label="Theme"
      />,
    );
    container.querySelectorAll<HTMLInputElement>("input")[2]?.click();
    expect(picked).toBe(2);
  });
});

describe("SettingsRow", () => {
  it("names the control inside it by the row's label", () => {
    mount(
      <SettingsRow label="Animations">
        <Switch checked onChange={() => {}} label="Animations" />
      </SettingsRow>,
    );
    const toggle = container.querySelector('[role="switch"]');
    expect(toggle?.hasAttribute("aria-label")).toBe(false);
    expect(toggle && labelledName(toggle)).toBe("Animations");
  });

  it("leaves a switch outside a row to its own label", () => {
    mount(<Switch checked={false} onChange={() => {}} label="Enabled" />);
    const toggle = container.querySelector('[role="switch"]');
    expect(toggle?.getAttribute("aria-label")).toBe("Enabled");
    expect(toggle?.hasAttribute("aria-labelledby")).toBe(false);
  });
});
