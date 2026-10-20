/**
 * What the formatting toolbar can apply and report, shared by the toolbar of
 * the rich editor and raw mode (`rawFormatting.ts`), which do the same buttons
 * as edits to the Markdown text.
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
  | "superscript"
  | "divider"
  | "table"
  | "codeBlock"
  | "indent"
  | "outdent"
  | "clearFormatting";

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
  /** Only true in the rich editor. See `getRawActiveFormats`. */
  table: boolean;
  codeBlock: boolean;
}

/**
 * A change to the value of a text field, with the final position of its
 * selection.
 */
export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}
