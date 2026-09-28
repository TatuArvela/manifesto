import type { Note } from "@manifesto/shared";
import { checkImportSize, type Importer, importedNote } from "./importer.js";
import { readTar } from "./tar.js";

/** Joplin's item types, as `type_` numbers them. */
const NOTE = "1";
const TAG = "5";
const NOTE_TAG = "6";

interface JoplinItem {
  title: string;
  body: string;
  meta: Map<string, string>;
}

/**
 * One item as Joplin serializes it: its title on the first line, a blank
 * line, its body, a blank line, and then its metadata as `key: value` lines.
 * An item with no title or body (a note-to-tag link) is metadata alone.
 */
export function parseJoplinItem(text: string): JoplinItem {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const meta = new Map<string, string>();
  let end = lines.length;
  while (end > 0) {
    const match = /^([a-z_]+): ?(.*)$/.exec(lines[end - 1] ?? "");
    if (!match) break;
    meta.set(match[1] as string, match[2] as string);
    end--;
  }
  const head = lines.slice(0, end);
  while (head.length > 0 && head[head.length - 1] === "") head.pop();
  const title = head[0] ?? "";
  const body = head.slice(1).join("\n").replace(/^\n+/, "");
  return { title, body, meta };
}

/**
 * Joplin keeps attachments as resources, linked from a note as `:/<id>`.
 * They are not in a note here, so an image link goes and any other keeps its
 * words.
 */
function withoutResourceLinks(body: string): string {
  return body
    .replace(/!\[[^\]]*\]\(:\/[0-9a-f]{32}\)\n?/g, "")
    .replace(/\[([^\]]*)\]\(:\/[0-9a-f]{32}\)/g, "$1");
}

function joplinTime(raw: string | undefined): string | null {
  if (!raw) return null;
  // Older exports write milliseconds, newer ISO 8601.
  if (/^\d+$/.test(raw)) return new Date(Number(raw)).toISOString();
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

/**
 * Joplin's `.jex` export: a tar of every item as Markdown with metadata
 * (see `parseJoplinItem`), notes, tags and the links between them among
 * notebooks and resources. Notes come with their tags; notebooks, which
 * notes here have none of, and attachments are left behind. An encrypted
 * item cannot be read and is skipped; an archive of nothing but those is
 * refused.
 */
export const joplinImporter: Importer = {
  format: "Joplin",
  extensions: [".jex"],
  async fromFile(file) {
    checkImportSize(file);
    const entries = readTar(new Uint8Array(await file.arrayBuffer()));
    const decoder = new TextDecoder();
    const items = entries
      .filter((entry) => entry.name.endsWith(".md"))
      .map((entry) => parseJoplinItem(decoder.decode(entry.bytes)));
    if (!items.some((item) => item.meta.has("type_"))) return null;

    const tagNames = new Map<string, string>();
    for (const item of items) {
      const id = item.meta.get("id");
      if (item.meta.get("type_") === TAG && id) tagNames.set(id, item.title);
    }
    const tagsOf = new Map<string, string[]>();
    for (const item of items) {
      if (item.meta.get("type_") !== NOTE_TAG) continue;
      const note = item.meta.get("note_id");
      const tag = tagNames.get(item.meta.get("tag_id") ?? "");
      if (note && tag) tagsOf.set(note, [...(tagsOf.get(note) ?? []), tag]);
    }

    const notes: Note[] = [];
    let encrypted = 0;
    for (const item of items) {
      if (item.meta.get("type_") !== NOTE) continue;
      if (item.meta.get("encryption_applied") === "1") {
        encrypted++;
        continue;
      }
      const deleted = item.meta.get("deleted_time");
      notes.push(
        importedNote({
          title: item.title,
          content: withoutResourceLinks(item.body),
          tags: tagsOf.get(item.meta.get("id") ?? "") ?? [],
          trashed: deleted !== undefined && deleted !== "" && deleted !== "0",
          createdAt: joplinTime(
            item.meta.get("user_created_time") ?? item.meta.get("created_time"),
          ),
          updatedAt: joplinTime(
            item.meta.get("user_updated_time") ?? item.meta.get("updated_time"),
          ),
        }),
      );
    }
    if (notes.length === 0 && encrypted > 0) {
      throw new Error("The Joplin export is encrypted");
    }
    return notes;
  },
};
