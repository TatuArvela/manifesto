import { describe, expect, it } from "vitest";
import {
  insertRawImage,
  rawSpanValue,
  setRawSpan,
} from "./rawSpanFormatting.ts";

describe("setRawSpan", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(setRawSpan("a bc d", 2, 4, "color", "red")).toEqual({
      value: 'a <span data-color="red">bc</span> d',
      selectionStart: 25,
      selectionEnd: 27,
    });
  });

  it("changes the value of a span that already holds exactly the selection", () => {
    const value = 'a <span data-color="red">bc</span> d';
    expect(setRawSpan(value, 25, 27, "color", "blue")?.value).toBe(
      'a <span data-color="blue">bc</span> d',
    );
  });

  it("removes the span for the default, and does nothing with no span", () => {
    const value = 'a <span data-font="serif">bc</span> d';
    expect(setRawSpan(value, 26, 28, "font", "default")?.value).toBe("a bc d");
    expect(setRawSpan("a bc d", 2, 4, "font", "default")).toBeNull();
  });
});

describe("rawSpanValue", () => {
  it("tells the span that holds the caret on its line", () => {
    const value = 'x <span data-color="green">ab</span> y';
    expect(rawSpanValue(value, 28, "color")).toBe("green");
    expect(rawSpanValue(value, 37, "color")).toBe(false);
    expect(rawSpanValue(value, 28, "font")).toBe(false);
  });
});

describe("insertRawImage", () => {
  it("puts a pointer at the caret", () => {
    expect(insertRawImage("ab", 1, 1, 2)).toEqual({
      value: "a![](image:2)b",
      selectionStart: 13,
      selectionEnd: 13,
    });
    expect(insertRawImage("ab", 1, 1, 0)).toBeNull();
  });
});
