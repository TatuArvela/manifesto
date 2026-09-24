import type { Note, NoteCreate, NoteReminder } from "@manifesto/shared";
import { NoteColor, NoteFont, REMINDER_RECURRENCES } from "@manifesto/shared";
import { ulid } from "ulid";
import {
  frontmatterBoolean,
  frontmatterDate,
  frontmatterList,
  frontmatterString,
  splitFrontmatter,
} from "./frontmatter.js";
import { isKeepNote, keepNoteToNote } from "./keepImport.js";
import { parseLinkPreviews } from "./linkPreview.js";
import { isZipFile, readZip, type ZipEntry } from "./zip.js";

export type ImportResult =
  | { kind: "single"; note: Partial<NoteCreate> }
  | { kind: "bulk"; notes: Note[] };

const MARKDOWN_EXTS = [".md", ".markdown"];
const JSON_EXTS = [".json"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"];

// Guard against a multi-GB drop locking the tab in JSON.parse.
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return cleaned || "note";
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function noteToMarkdown(note: Pick<Note, "title" | "content">): string {
  const title = note.title.trim();
  const body = note.content ?? "";
  const text = title ? `# ${title}\n\n${body}` : body;
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function downloadNoteAsMarkdown(
  note: Pick<Note, "title" | "content">,
): void {
  const filename = `${sanitizeFilename(note.title || "note")}.md`;
  triggerDownload(noteToMarkdown(note), filename, "text/markdown");
}

export function downloadNoteAsJson(note: Note): void {
  const filename = `${sanitizeFilename(note.title || "note")}.json`;
  triggerDownload(JSON.stringify(note, null, 2), filename, "application/json");
}

/**
 * One Markdown file as a note. A leading `# ` heading is the title; YAML
 * frontmatter, as Obsidian and other Markdown note apps write it, can give
 * the title, `tags` (or `tag`) and the pinned / archived flags too.
 */
export function parseMarkdownToNote(text: string): Partial<NoteCreate> {
  const { data, body } = splitFrontmatter(text.replace(/^\uFEFF/, ""));
  const lines = body.split(/\r?\n/);
  let title = frontmatterString(data.title) ?? "";
  let contentStart = 0;
  if (lines[0]?.startsWith("# ")) {
    title = lines[0].slice(2).trim();
    contentStart = 1;
    while (contentStart < lines.length && lines[contentStart].trim() === "") {
      contentStart++;
    }
  }
  const content = lines.slice(contentStart).join("\n").replace(/\s+$/, "");
  const note: Partial<NoteCreate> = { title, content };
  const tags = frontmatterList(data.tags ?? data.tag);
  if (tags.length > 0) note.tags = [...new Set(tags)];
  const pinned = frontmatterBoolean(data.pinned);
  if (pinned !== undefined) note.pinned = pinned;
  const archived = frontmatterBoolean(data.archived);
  if (archived !== undefined) note.archived = archived;
  return note;
}

/**
 * A Markdown file from a folder of notes. Such apps name the note after the
 * file rather than heading it, so the file name is the fallback title, and
 * the folders it sits in (Nextcloud Notes' categories, an Obsidian vault's
 * directories) become tags.
 */
export function markdownFileToNote(
  path: string,
  text: string,
  now: string = new Date().toISOString(),
): Note {
  const note = parseMarkdownToNote(text);
  const { data } = splitFrontmatter(text.replace(/^\uFEFF/, ""));
  const segments = path.split("/").filter((s) => s !== "");
  const file = segments.pop() ?? "";
  const stem = file.replace(/\.(md|markdown)$/i, "");
  const updatedAt =
    frontmatterDate(data.updated ?? data.modified ?? data.lastmod) ?? now;
  const createdAt =
    frontmatterDate(data.created ?? data.date) ??
    (updatedAt < now ? updatedAt : now);
  return normalizeImportedNote({
    ...note,
    id: ulid(),
    title: note.title || stem,
    tags: [...new Set([...(note.tags ?? []), ...segments])],
    position: Date.parse(createdAt),
    createdAt,
    updatedAt,
  });
}

const NOTE_COLORS = new Set<string>(Object.values(NoteColor));
const NOTE_FONTS = new Set<string>(Object.values(NoteFont));
const RECURRENCES = new Set<string>(REMINDER_RECURRENCES);

function parseReminder(raw: unknown): NoteReminder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.time !== "string") return null;
  return {
    time: r.time,
    recurrence:
      typeof r.recurrence === "string" && RECURRENCES.has(r.recurrence)
        ? (r.recurrence as NoteReminder["recurrence"])
        : "none",
    timezone: typeof r.timezone === "string" ? r.timezone : "UTC",
    ...(typeof r.lastFiredAt === "string"
      ? { lastFiredAt: r.lastFiredAt }
      : {}),
  };
}

function parseStringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Coerces a shape-checked import item into a complete, renderable `Note`.
 *
 * The bulk path previously handed `data as Note[]` straight to storage, so an
 * unknown `color` reached `noteColorMap[...]` as `undefined` and threw inside
 * `NoteCard` on every load thereafter, since the note had been persisted.
 * Identity fields are trusted (`isValidNoteShape` has already checked them);
 * everything else is validated and falls back to a safe default.
 */
function normalizeImportedNote(raw: Record<string, unknown>): Note {
  return {
    id: raw.id as string,
    title: raw.title as string,
    content: raw.content as string,
    color:
      typeof raw.color === "string" && NOTE_COLORS.has(raw.color)
        ? (raw.color as NoteColor)
        : NoteColor.Default,
    font:
      typeof raw.font === "string" && NOTE_FONTS.has(raw.font)
        ? (raw.font as NoteFont)
        : NoteFont.Default,
    pinned: raw.pinned === true,
    archived: raw.archived === true,
    trashed: raw.trashed === true,
    trashedAt: typeof raw.trashedAt === "string" ? raw.trashedAt : null,
    position:
      typeof raw.position === "number" && Number.isFinite(raw.position)
        ? raw.position
        : Date.now(),
    tags: parseStringArray(raw.tags),
    images: parseStringArray(raw.images),
    linkPreviews: parseLinkPreviews(raw.linkPreviews),
    reminder: parseReminder(raw.reminder),
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

function isValidNoteShape(item: unknown): item is Note {
  if (typeof item !== "object" || item === null) return false;
  const n = item as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.title === "string" &&
    typeof n.content === "string" &&
    typeof n.createdAt === "string" &&
    typeof n.updatedAt === "string" &&
    Array.isArray(n.tags)
  );
}

export function parseSingleNoteJson(data: unknown): Partial<NoteCreate> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid note schema");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.title !== "string" || typeof raw.content !== "string") {
    throw new Error("Invalid note schema");
  }
  const out: Partial<NoteCreate> = {
    title: raw.title,
    content: raw.content,
  };
  if (typeof raw.color === "string" && NOTE_COLORS.has(raw.color)) {
    out.color = raw.color as NoteColor;
  }
  if (typeof raw.font === "string" && NOTE_FONTS.has(raw.font)) {
    out.font = raw.font as NoteFont;
  }
  if (typeof raw.pinned === "boolean") out.pinned = raw.pinned;
  if (typeof raw.archived === "boolean") out.archived = raw.archived;
  if (Array.isArray(raw.tags)) {
    out.tags = raw.tags.filter((t): t is string => typeof t === "string");
  }
  if (Array.isArray(raw.images)) {
    out.images = raw.images.filter((i): i is string => typeof i === "string");
  }
  if (Array.isArray(raw.linkPreviews)) {
    out.linkPreviews = parseLinkPreviews(raw.linkPreviews);
  }
  if (
    raw.reminder &&
    typeof raw.reminder === "object" &&
    typeof (raw.reminder as { time?: unknown }).time === "string"
  ) {
    out.reminder = raw.reminder as NoteCreate["reminder"];
  }
  return out;
}

export function parseNoteJson(text: string): ImportResult {
  const data = JSON.parse(text);
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!isValidNoteShape(item)) throw new Error("Invalid note schema");
    }
    return {
      kind: "bulk",
      notes: data.map((item) =>
        normalizeImportedNote(item as Record<string, unknown>),
      ),
    };
  }
  return { kind: "single", note: parseSingleNoteJson(data) };
}

function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i).toLowerCase();
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    IMAGE_EXTS.includes(fileExtension(file.name))
  );
}

export function isImportableFile(file: File): boolean {
  const ext = fileExtension(file.name);
  if (MARKDOWN_EXTS.includes(ext) || JSON_EXTS.includes(ext)) return true;
  if (file.type === "application/json") return true;
  if (file.type === "text/markdown" || file.type === "text/x-markdown") {
    return true;
  }
  // Takeout: an archive, or an unpacked folder's JSON with its images.
  if (isZipFile(file) || isImageFile(file)) return true;
  return false;
}

export async function parseImportFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`File exceeds ${MAX_IMPORT_BYTES} bytes`);
  }
  const text = await file.text();
  const ext = fileExtension(file.name);
  if (MARKDOWN_EXTS.includes(ext) || file.type.startsWith("text/markdown")) {
    return { kind: "single", note: parseMarkdownToNote(text) };
  }
  if (JSON_EXTS.includes(ext) || file.type === "application/json") {
    return parseNoteJson(text);
  }
  throw new Error("Unsupported file type");
}

export interface ImportSummary {
  singleCount: number;
  bulkCount: number;
  failedCount: number;
}

interface ImportHandlers {
  /** Resolves `null` if the note could not be stored. */
  createNote: (input: Partial<NoteCreate>) => Promise<Note | null>;
  /** Resolves `false` if the merge could not be stored. */
  importBulk: (notes: Note[]) => Promise<boolean>;
}

const textDecoder = new TextDecoder();

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/**
 * Reads an archive into notes: every Markdown file in it, and every Keep note
 * of a Takeout zip, which holds Keep's per-note JSON files beside their
 * attachments. Everything else (other Google products, Keep's `.html` twins,
 * a vault's settings) is ignored. The byte budget is shared by every entry,
 * so an archive cannot add up to more than one file would be allowed.
 *
 * A server's account download is the exception: its `notes.json` holds every
 * note whole (ids, colors, images, the trash) and its Markdown files are the
 * same notes stripped down for other tools, so when it is there it is the
 * import and the rest of the archive is not read.
 */
async function notesFromZip(file: File): Promise<Note[]> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`File exceeds ${MAX_IMPORT_BYTES} bytes`);
  }
  const entries = await readZip(file);
  let budget = MAX_IMPORT_BYTES;
  const read = async (entry: ZipEntry) => {
    const bytes = await entry.read(budget);
    budget -= bytes.length;
    return bytes;
  };
  const byDirAndName = new Map<string, ZipEntry>();
  for (const entry of entries) byDirAndName.set(entry.name, entry);

  const accountNotes = entries.find((e) =>
    /^([^/]+\/)?notes\.json$/.test(e.name),
  );
  if (accountNotes) {
    const data = parseJsonOrNull(textDecoder.decode(await read(accountNotes)));
    if (
      Array.isArray(data) &&
      data.length > 0 &&
      !data.some((item) => !isValidNoteShape(item))
    ) {
      return data.map((item: Record<string, unknown>) =>
        normalizeImportedNote(item),
      );
    }
  }

  // A zipped folder puts every file under that folder's name; it names the
  // archive, not a category, so it is not made a tag.
  const markdown = entries.filter((e) =>
    MARKDOWN_EXTS.includes(fileExtension(e.name)),
  );
  const firstDir = (name: string) =>
    name.includes("/") ? name.slice(0, name.indexOf("/") + 1) : "";
  const root =
    markdown.length > 0 &&
    markdown.every((e) => firstDir(e.name) === firstDir(markdown[0].name))
      ? firstDir(markdown[0].name)
      : "";

  const notes: Note[] = [];
  for (const entry of markdown) {
    // Folders a tool keeps for itself are not notes.
    if (/(^|\/)\.(obsidian|trash|git)\//.test(entry.name)) continue;
    notes.push(
      markdownFileToNote(
        entry.name.slice(root.length),
        textDecoder.decode(await read(entry)),
      ),
    );
  }
  for (const entry of entries) {
    if (fileExtension(entry.name) !== ".json") continue;
    const data = parseJsonOrNull(textDecoder.decode(await read(entry)));
    if (!isKeepNote(data)) continue;
    const dir = entry.name.slice(0, entry.name.lastIndexOf("/") + 1);
    notes.push(
      await keepNoteToNote(data as Record<string, unknown>, async (path) => {
        const sibling = byDirAndName.get(dir + baseName(path));
        return sibling ? read(sibling) : null;
      }),
    );
  }
  return notes;
}

/**
 * Process one or more files: each file becomes either a new single note
 * (markdown / single-note JSON) or a bulk merge (JSON array, archive). Keep
 * notes picked from an unpacked Takeout folder are gathered into one merge,
 * with the images picked alongside them as their attachments.
 */
export async function importFiles(
  files: Iterable<File>,
  handlers: ImportHandlers,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    singleCount: 0,
    bulkCount: 0,
    failedCount: 0,
  };
  const all = [...files];
  const images = new Map<string, File>();
  for (const file of all) {
    if (isImageFile(file)) images.set(baseName(file.name), file);
  }
  const keepNotes: Note[] = [];
  let usedImages = false;

  const bulk = async (notes: Note[]) => {
    if (notes.length > 0 && (await handlers.importBulk(notes))) {
      summary.bulkCount += notes.length;
    } else {
      summary.failedCount++;
    }
  };

  for (const file of all) {
    if (isImageFile(file)) continue;
    if (!isImportableFile(file)) {
      summary.failedCount++;
      continue;
    }
    try {
      if (isZipFile(file)) {
        await bulk(await notesFromZip(file));
        continue;
      }
      if (
        fileExtension(file.name) === ".json" &&
        file.size <= MAX_IMPORT_BYTES
      ) {
        const data = parseJsonOrNull(await file.text());
        if (isKeepNote(data)) {
          keepNotes.push(
            await keepNoteToNote(
              data as Record<string, unknown>,
              async (path) => {
                const image = images.get(baseName(path));
                if (!image) return null;
                usedImages = true;
                return new Uint8Array(await image.arrayBuffer());
              },
            ),
          );
          continue;
        }
      }
      const result = await parseImportFile(file);
      // The handlers report their own failure and resolve, so a rejection here
      // means the *file* was unreadable; a falsy result means it parsed and
      // could not be stored. Both are one failed file to the user.
      if (result.kind === "single") {
        if (await handlers.createNote(result.note)) {
          summary.singleCount++;
        } else {
          summary.failedCount++;
        }
      } else {
        await bulk(result.notes);
      }
    } catch {
      summary.failedCount++;
    }
  }
  if (keepNotes.length > 0) await bulk(keepNotes);
  // An image is only ever an attachment; picked with no note to attach it
  // to, it is one file that did not import.
  if (!usedImages && keepNotes.length === 0) summary.failedCount += images.size;
  return summary;
}
