import type { Note } from "@manifesto/shared";

/**
 * What a card is called to a screen reader: its title, or else the first line
 * of its text without the Markdown that opens it. Every untitled card used to
 * be called "Title", the placeholder, so a list of them could not be told
 * apart. Empty when the note has neither.
 */
export function cardName(note: Pick<Note, "title" | "content">): string {
  if (note.title.trim()) return note.title.trim();
  for (const raw of note.content.slice(0, 2000).split("\n")) {
    let line = raw.trim();
    // A task box, a list marker, a quote or a heading, in any nesting.
    for (let i = 0; i < 8; i++) {
      const next = line
        .replace(/^(?:[-*+]|\d{1,9}[.)]|>|#{1,6})(?=\s|$)/, "")
        .replace(/^\[[ xX]?\]/, "")
        .trim();
      if (next === line) break;
      line = next;
    }
    if (line) return line.length > 80 ? `${line.slice(0, 80)}…` : line;
  }
  return "";
}
