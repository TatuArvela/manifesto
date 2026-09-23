import { describe, expect, it } from "vitest";
import {
  MAX_SHARED_TEXT,
  sharedTextFromForm,
  sharedTextToDraft,
} from "./shareTarget.js";

describe("sharedTextToDraft", () => {
  it("keeps a page title and puts an Android-style URL in the content", () => {
    expect(
      sharedTextToDraft({
        title: "An article",
        text: "https://example.com/a",
        url: "",
      }),
    ).toEqual({ title: "An article", content: "https://example.com/a" });
  });

  it("appends a separate URL to the selected text", () => {
    expect(
      sharedTextToDraft({ title: "", text: "A quote", url: "https://x.y/" }),
    ).toEqual({ title: "", content: "A quote\n\nhttps://x.y/" });
  });

  it("does not repeat a URL the text already holds", () => {
    expect(
      sharedTextToDraft({
        title: "",
        text: "see https://x.y/",
        url: "https://x.y/",
      }).content,
    ).toBe("see https://x.y/");
  });

  it("drops a title that only repeats the content", () => {
    expect(
      sharedTextToDraft({
        title: "https://x.y/",
        text: "",
        url: "https://x.y/",
      }),
    ).toEqual({ title: "", content: "https://x.y/" });
  });
});

describe("sharedTextFromForm", () => {
  it("reads the three text fields and bounds them", () => {
    const form = new FormData();
    form.set("title", "T");
    form.set("text", "x".repeat(MAX_SHARED_TEXT + 10));
    form.set("url", new Blob(["file"]));
    const shared = sharedTextFromForm(form);
    expect(shared.title).toBe("T");
    expect(shared.text).toHaveLength(MAX_SHARED_TEXT);
    expect(shared.url).toBe("");
  });
});
