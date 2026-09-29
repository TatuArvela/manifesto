/**
 * What the formatting toolbar can apply and report, shared by the rich editor's
 * toolbar and raw mode (`rawFormatting.ts`), which express the same buttons as
 * edits to the markdown text.
 */

export type FormatType =
  | "heading"
  | "bold"
  | "italic"
  | "quote"
  | "code"
  | "link"
  | "numberedList"
  | "unorderedList"
  | "checklist"
  | "strikethrough"
  | "underline"
  | "subscript"
  | "superscript";

export interface ActiveFormats {
  heading: number | false;
  bold: boolean;
  italic: boolean;
  quote: boolean;
  code: boolean;
  link: boolean;
  numberedList: boolean;
  unorderedList: boolean;
  checklist: boolean;
  strikethrough: boolean;
  underline: boolean;
  subscript: boolean;
  superscript: boolean;
}

/** A change to a text field's value, with where its selection ends up. */
export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}
