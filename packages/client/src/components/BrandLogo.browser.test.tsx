import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLogo } from "./BrandLogo.js";
import "../styles.css";

let host: HTMLDivElement;

function shown(): (string | null)[] {
  return [...host.querySelectorAll("img")]
    .filter((img) => getComputedStyle(img).display !== "none")
    .map((img) => img.getAttribute("src"));
}

function inverted(): boolean {
  const img = host.querySelector("img");
  return img ? getComputedStyle(img).filter.includes("invert") : false;
}

function mount(logo: Parameters<typeof BrandLogo>[0]["logo"], dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  host = document.createElement("div");
  document.body.appendChild(host);
  render(<BrandLogo logo={logo} class="h-6 w-6" />, host);
}

afterEach(() => {
  render(null, host);
  host.remove();
  document.documentElement.classList.remove("dark");
});

describe("a logo", () => {
  const paired = { light: "/l.svg", dark: "/d.svg", invertInDark: true };

  it("draws the light variant in the light theme", () => {
    mount(paired, false);
    expect(shown()).toEqual(["/l.svg"]);
  });

  it("draws the dark variant in the dark theme, uninverted", () => {
    mount(paired, true);
    expect(shown()).toEqual(["/d.svg"]);
    expect(
      [...host.querySelectorAll("img")].some((img) =>
        getComputedStyle(img).filter.includes("invert"),
      ),
    ).toBe(false);
  });

  it("without a dark variant, inverts only if it asks to", () => {
    mount({ light: "/l.svg", dark: null, invertInDark: true }, true);
    expect(inverted()).toBe(true);
    render(null, host);
    host.remove();
    mount({ light: "/l.svg", dark: null, invertInDark: false }, true);
    expect(inverted()).toBe(false);
  });
});
