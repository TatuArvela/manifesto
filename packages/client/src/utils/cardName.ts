import type { Note } from "@manifesto/shared";

/**
 * The name of a card for a screen reader: its title, or else the first line of
 * its text without the Markdown that opens it. Before, each untitled card had
 * the name "Title", the placeholder. Thus, nobody could tell a list of them
 * apart. Empty when the note has neither.
 */
export function cardName(note: Pick<Note, "title" | "content">): string {
  if (note.title.trim()) return note.title.trim();
  for (const raw of note.content.slice(0, 2000).split("\n")) {
    let line = raw.trim();
    // A task box, a list marker, a quote or a heading, at any nesting level.
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
