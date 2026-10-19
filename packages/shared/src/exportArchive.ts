import type { Note, NoteVersion } from "./note.ts";
import { currentNoteFormat } from "./noteFormat.ts";

/**
 * The layout of an export archive. Both modes write it: a server for an account
 * (`GET /api/v1/export`), and a browser in open mode. It is in one place, so
 * that the two make the same zip, and you can import an archive from either one
 * in all places.
 *
 * - `notes.json`: all notes, with the trash and the archive, in the import
 *   format of the client, with images inlined as `data:` URLs.
 * - `notes/<title>.md`: each note that is not in the trash, as Markdown, with
 *   frontmatter that the Markdown-folder import of the client reads back. Other
 *   tools can open it.
 * - `versions.json`: the version history of those notes.
 * - `manifest.json`: the format of the notes and the versions
 *   (`noteFormat.ts`). Thus, an import upgrades an older archive, and refuses
 *   an archive from a newer version. It does not read it incorrectly. An
 *   archive without one is from before the app recorded formats, and is format
 *   1.
 * - `preferences.json`: the settings, when the caller gives them: those of the
 *   account in connected mode, and those of this browser in open mode. They are
 *   for a person to read and keep. An import of an archive does not apply them.
 *
 * The caller adds its own files (the `account.json` of the server), and encodes
 * and zips the text.
 */
export const EXPORT_NOTES_FILE = "notes.json";
export const EXPORT_VERSIONS_FILE = "versions.json";
export const EXPORT_PREFERENCES_FILE = "preferences.json";
export const EXPORT_MANIFEST_FILE = "manifest.json";

/** The contents of `manifest.json`. */
export interface ExportManifest {
  format: number;
}

export function exportArchiveFiles(
  notes: Note[],
  versions: NoteVersion[],
  preferences?: Record<string, unknown>,
): { name: string; text: string }[] {
  const names = new Set<string>();
  const markdown = notes
    .filter((note) => !note.trashed)
    .map((note) => ({
      name: `notes/${uniqueName(fileNameOf(note), names)}.md`,
      text: noteToMarkdownFile(note),
    }));
  const manifest: ExportManifest = { format: currentNoteFormat() };
  return [
    { name: EXPORT_MANIFEST_FILE, text: JSON.stringify(manifest, null, 2) },
    { name: EXPORT_NOTES_FILE, text: JSON.stringify(notes, null, 2) },
    ...markdown,
    { name: EXPORT_VERSIONS_FILE, text: JSON.stringify(versions, null, 2) },
    ...(preferences
      ? [
          {
            name: EXPORT_PREFERENCES_FILE,
            text: JSON.stringify(preferences, null, 2),
          },
        ]
      : []),
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

/** YAML needs quotes only where a plain scalar would be read incorrectly. */
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
