import { describe, expect, it } from "vitest";
import {
  darkCustomColor,
  darkHue,
  lightCustomColor,
  lightHue,
} from "./prefs.ts";
import "./theme.ts";

const property = (name: string) =>
  document.documentElement.style.getPropertyValue(name);

describe("the tint of each theme on <html>", () => {
  it("sets the dark tint from a preset", () => {
    const previous = darkHue.value;
    darkHue.value = "black";
    expect(property("--dark-dim")).toBe("20.5%");
    darkHue.value = "teal";
    expect(property("--dark-tint-h")).toBe("185");
    expect(property("--dark-dim")).toBe("0%");
    darkHue.value = previous;
  });

  it("sets the light tint from a custom colour, and follows the colour", () => {
    const previous = [lightHue.value, lightCustomColor.value] as const;
    lightHue.value = "custom";
    lightCustomColor.value = "#ffffff";
    expect(property("--light-tint-c")).toBe("0");
    expect(property("--light-dim")).toBe("0%");
    lightCustomColor.value = "#3b82f6";
    expect(Number(property("--light-tint-c"))).toBeGreaterThan(0);
    expect(property("--light-dim")).toBe("12%");
    [lightHue.value, lightCustomColor.value] = previous;
  });

  it("makes the dark page black from a black custom colour", () => {
    const previous = [darkHue.value, darkCustomColor.value] as const;
    darkHue.value = "custom";
    darkCustomColor.value = "#000000";
    expect(property("--dark-dim")).toBe("20.5%");
    [darkHue.value, darkCustomColor.value] = previous;
  });
});
