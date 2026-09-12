import { describe, expect, it } from "vitest";
import type { FormatType } from "../components/FormattingToolbar.js";
import {
  applyRawFormat,
  applyRawLink,
  getRawActiveFormats,
  removeRawLink,
  type TextEdit,
} from "./rawFormatting.js";

// `‹` and `›` mark a selection, `|` a caret, in both the input and the
// expected output, so a case reads as the textarea would look.
function parse(marked: string): [string, number, number] {
  const caret = marked.indexOf("|");
  if (caret !== -1) {
    return [marked.replace("|", ""), caret, caret];
  }
  const start = marked.indexOf("‹");
  const end = marked.indexOf("›") - 1;
  return [marked.replace("‹", "").replace("›", ""), start, end];
}

function mark({ value, selectionStart, selectionEnd }: TextEdit): string {
  if (selectionStart === selectionEnd) {
    return `${value.slice(0, selectionStart)}|${value.slice(selectionStart)}`;
  }
  return `${value.slice(0, selectionStart)}‹${value.slice(selectionStart, selectionEnd)}›${value.slice(selectionEnd)}`;
}

function format(marked: string, type: FormatType, arg?: string): string {
  const [value, start, end] = parse(marked);
  const edit = applyRawFormat(value, start, end, type, arg);
  if (!edit) throw new Error("no edit");
  return mark(edit);
}

function active(marked: string) {
  const [value, start, end] = parse(marked);
  return getRawActiveFormats(value, start, end);
}

describe("inline formats in raw mode", () => {
  it("wraps a selection", () => {
    expect(format("a ‹word› b", "bold")).toBe("a **‹word›** b");
    expect(format("a ‹word› b", "italic")).toBe("a *‹word›* b");
    expect(format("a ‹word› b", "strikethrough")).toBe("a ~~‹word›~~ b");
    expect(format("a ‹word› b", "code")).toBe("a `‹word›` b");
    expect(format("a ‹word› b", "underline")).toBe("a <u>‹word›</u> b");
    expect(format("a ‹word› b", "superscript")).toBe("a <sup>‹word›</sup> b");
  });

  it("unwraps a selection that is already formatted", () => {
    expect(format("a **‹word›** b", "bold")).toBe("a ‹word› b");
    expect(format("a <sub>‹word›</sub> b", "subscript")).toBe("a ‹word› b");
  });

  it("unwraps a selection that takes in its own markers", () => {
    // Selecting the whole `**text**` by double-click or drag is the natural
    // way to pick it, and used to read as unformatted and gain four more.
    expect(active("a ‹**word**› b")).toMatchObject({ bold: true });
    expect(format("a ‹**word**› b", "bold")).toBe("a ‹word› b");
    expect(format("‹***both***›", "italic")).toBe("**‹both›**");
    expect(format("‹`x`›", "code")).toBe("‹x›");
  });

  it("does not read a selection across two formatted runs as one", () => {
    // Peeling the outer asterisks would leave `a** and **b`, which reads as
    // bold and would be unwrapped into broken markdown.
    expect(active("‹**a** and **b**›").bold).toBe(false);
    expect(format("‹**a** and **b**›", "italic")).toBe("*‹**a** and **b**›*");
  });

  it("finds a format's markers past other formats nested inside them", () => {
    expect(active("‹<u>**word**</u>›")).toMatchObject({
      bold: true,
      underline: true,
    });
    expect(format("‹<u>**word**</u>›", "underline")).toBe("**‹word›**");
    expect(format("<u>**wo|rd**</u>", "bold")).toBe("<u>‹word›</u>");
    expect(format("**<sup>‹x›</sup>**", "bold")).toBe("<sup>‹x›</sup>");
  });

  it("does not peel markup off only one end of a selection", () => {
    // `**word` is not bold text with its closing half out of view; wrapping
    // just `word` would leave `****word**`.
    expect(format("‹**word›", "bold")).toBe("**‹**word›**");
  });

  it("keeps whitespace at the edges of a selection outside the markers", () => {
    // `** word **` is not bold in markdown, just asterisks.
    expect(format("a‹ word ›b", "bold")).toBe("a **‹word›** b");
  });

  it("formats the word under a bare caret", () => {
    expect(format("one tw|o three", "bold")).toBe("one **‹two›** three");
  });

  it("unformats the word under a bare caret", () => {
    expect(format("one **tw|o** three", "bold")).toBe("one ‹two› three");
  });

  it("inserts empty markers where there is no word", () => {
    expect(format("one |", "bold")).toBe("one **|**");
  });

  it("tells bold from italic when they share an asterisk", () => {
    expect(active("***‹both›***")).toMatchObject({ bold: true, italic: true });
    expect(active("**‹bold›**")).toMatchObject({ bold: true, italic: false });
    expect(active("*‹it›*")).toMatchObject({ bold: false, italic: true });
    expect(format("***‹both›***", "italic")).toBe("**‹both›**");
    expect(format("***‹both›***", "bold")).toBe("*‹both›*");
  });

  it("reads underscores as emphasis too", () => {
    expect(active("__‹bold›__")).toMatchObject({ bold: true });
    expect(format("_‹it›_", "italic")).toBe("‹it›");
  });
});

describe("block formats in raw mode", () => {
  it("toggles a heading on the caret's line", () => {
    expect(format("Tit|le", "heading", "2")).toBe("## Tit|le");
    expect(format("## Tit|le", "heading", "2")).toBe("Tit|le");
    expect(format("# Tit|le", "heading", "3")).toBe("### Tit|le");
  });

  it("starts a checklist on an empty line", () => {
    expect(format("|", "checklist")).toBe("- [ ] |");
  });

  it("turns every selected line into a task, skipping blank lines", () => {
    expect(format("‹milk\n\nbread›", "checklist")).toBe(
      "- [ ] ‹milk\n\n- [ ] bread›",
    );
  });

  it("turns bullets into tasks and tasks back into bullets", () => {
    expect(format("- mi|lk", "checklist")).toBe("- [ ] mi|lk");
    expect(format("- [x] mi|lk", "checklist")).toBe("- mi|lk");
  });

  it("keeps a task's nesting", () => {
    expect(format("  - chi|ld", "checklist")).toBe("  - [ ] chi|ld");
  });

  it("numbers lines and switches list kinds", () => {
    expect(format("‹a\nb›", "numberedList")).toBe("1. ‹a\n2. b›");
    expect(format("‹1. a\n2. b›", "unorderedList")).toBe("‹- a\n- b›");
    expect(format("‹- a\n- b›", "unorderedList")).toBe("‹a\nb›");
  });

  it("does not take in the line a selection only reaches the start of", () => {
    expect(format("‹a\n›b", "quote")).toBe("> ‹a\n›b");
  });

  it("toggles a quote", () => {
    expect(format("> quo|te", "quote")).toBe("quo|te");
  });

  it("leaves text it does not recognise untouched", () => {
    expect(format("#hashtag an|d text", "unorderedList")).toBe(
      "- #hashtag an|d text",
    );
  });

  it("reports the caret line's block formats", () => {
    expect(active("### He|ading")).toMatchObject({ heading: 3 });
    expect(active("- [ ] ta|sk")).toMatchObject({
      checklist: true,
      unorderedList: false,
    });
    expect(active("- bul|let")).toMatchObject({ unorderedList: true });
    expect(active("1. nu|mber")).toMatchObject({ numberedList: true });
    expect(active("> q|uote")).toMatchObject({ quote: true });
  });
});

describe("links in raw mode", () => {
  it("wraps the selection as a link", () => {
    const [value, start, end] = parse("see ‹docs› now");
    expect(mark(applyRawLink(value, start, end, "https://x.test"))).toBe(
      "see [docs](https://x.test)| now",
    );
  });

  it("uses the address as the text when nothing is selected", () => {
    const [value, start, end] = parse("see |");
    expect(mark(applyRawLink(value, start, end, "https://x.test"))).toBe(
      "see [https://x.test](https://x.test)|",
    );
  });

  it("unwraps the link around the caret", () => {
    const [value, start, end] = parse("see [do|cs](https://x.test) now");
    expect(active("see [do|cs](https://x.test) now").link).toBe(true);
    const edit = removeRawLink(value, start, end);
    expect(edit && mark(edit)).toBe("see ‹docs› now");
  });

  it("does not count a caret beside a link as inside it", () => {
    expect(active("see [docs](https://x.test)| now").link).toBe(false);
  });
});

describe("line boundaries in raw mode", () => {
  it("finds the first line when the text starts with a blank one", () => {
    expect(format("|\nmilk", "checklist")).toBe("- [ ] |\nmilk");
  });
});
