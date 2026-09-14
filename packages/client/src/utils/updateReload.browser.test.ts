import { afterEach, describe, expect, it } from "vitest";
import { pageIsIdle } from "./updateReload.js";

describe("pageIsIdle", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const mount = (html: string) => {
    document.body.innerHTML = html;
  };

  it("is idle with nothing open and nothing focused", () => {
    mount("<main><button>Settings</button></main>");
    expect(pageIsIdle()).toBe(true);
  });

  it("is not idle with a dialog open", () => {
    // The note editor is one, and its save waits out a debounce.
    mount('<div role="dialog" aria-modal="true"></div>');
    expect(pageIsIdle()).toBe(false);
  });

  it("is not idle while a field is being typed in", () => {
    mount('<input type="search">');
    (document.querySelector("input") as HTMLInputElement).focus();
    expect(pageIsIdle()).toBe(false);
  });

  it("is not idle with the caret in editable content", () => {
    mount('<div contenteditable="true">Milk</div>');
    (document.querySelector("div") as HTMLElement).focus();
    expect(pageIsIdle()).toBe(false);
  });

  it("is idle with only a checkbox focused", () => {
    mount('<input type="checkbox">');
    (document.querySelector("input") as HTMLInputElement).focus();
    expect(pageIsIdle()).toBe(true);
  });
});
