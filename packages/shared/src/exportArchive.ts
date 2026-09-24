import type { Note, NoteVersion } from "./note.js";

/**
 * The layout of an export archive, which both modes write: a server for an
 * account (`GET /api/export`) and a browser in open mode. Written in one place
 * so the two stay the same zip, and an archive from either imports anywhere.
 *
 * - `notes.json`: every note, the trash and archive included, in the client's
 *   import format with images inlined as `data:` URLs;
 * - `notes/<title>.md`: each note not in the trash as Markdown, with
 *   frontmatter the client's Markdown-folder import reads back, for any other
 *   tool to open;
 * - `versions.json`: the version history of those notes.
 *
 * The caller adds anything of its own (the server's `account.json`), and
 * encodes and zips the text.
 */
export const EXPORT_NOTES_FILE = "notes.json";
export const EXPORT_VERSIONS_FILE = "versions.json";

export function exportArchiveFiles(
  notes: Note[],
  versions: NoteVersion[],
): { name: string; text: string }[] {
  const names = new Set<string>();
  const markdown = notes
    .filter((note) => !note.trashed)
    .map((note) => ({
      name: `notes/${uniqueName(fileNameOf(note), names)}.md`,
      text: noteToMarkdownFile(note),
    }));
  return [
    { name: EXPORT_NOTES_FILE, text: JSON.stringify(notes, null, 2) },
    ...markdown,
    { name: EXPORT_VERSIONS_FILE, text: JSON.stringify(versions, null, 2) },
  ];
}

function fileNameOf(note: Note): string {
  const cleaned = note.title
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || "Untitled";
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  taken.add(name.toLowerCase());
  return name;
}

/** YAML only needs quoting where a plain scalar would be misread. */
function yamlString(value: string): string {
  return /^[\w .,'()&+-]*$/.test(value) &&
    value.trim() === value &&
    value !== ""
    ? value
    : JSON.stringify(value);
}

export function noteToMarkdownFile(note: Note): string {
  const front = [
    "---",
    `title: ${yamlString(note.title)}`,
    ...(note.tags.length > 0
      ? ["tags:", ...note.tags.map((tag) => `  - ${yamlString(tag)}`)]
      : []),
    ...(note.pinned ? ["pinned: true"] : []),
    ...(note.archived ? ["archived: true"] : []),
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    "---",
    "",
  ];
  const body = note.content.endsWith("\n") ? note.content : `${note.content}\n`;
  return `${front.join("\n")}${body}`;
}
