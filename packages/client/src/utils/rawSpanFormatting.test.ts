import { describe, expect, it } from "vitest";
import {
  insertRawImage,
  rawSpanSelectionValue,
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

describe("rawSpanSelectionValue", () => {
  const value =
    '<span data-color="red">ab</span><span data-color="blue">cd</span> ef';
  // "ab" is 23 to 25, "cd" is 56 to 58, " ef" is 65 to 68.

  it("gives the value of a selection in one span", () => {
    expect(rawSpanSelectionValue(value, 23, 25, "color")).toBe("red");
  });

  it("does not count the tags as text", () => {
    expect(rawSpanSelectionValue(value, 0, 32, "color")).toBe("red");
  });

  it("gives null for a selection of two values", () => {
    expect(rawSpanSelectionValue(value, 24, 57, "color")).toBeNull();
  });

  it("gives null for a selection of a value and no value", () => {
    expect(rawSpanSelectionValue(value, 57, 67, "color")).toBeNull();
  });

  it("gives false for a selection with no span", () => {
    expect(rawSpanSelectionValue(value, 65, 68, "color")).toBe(false);
  });

  it("reads the caret as rawSpanValue does", () => {
    expect(rawSpanSelectionValue(value, 57, 57, "color")).toBe("blue");
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
