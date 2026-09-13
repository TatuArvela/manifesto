import type { Note, NoteCreate, NoteReminder } from "@manifesto/shared";
import { NoteColor, NoteFont, REMINDER_RECURRENCES } from "@manifesto/shared";
import { parseLinkPreviews } from "./linkPreview.js";

export type ImportResult =
  | { kind: "single"; note: Partial<NoteCreate> }
  | { kind: "bulk"; notes: Note[] };

const MARKDOWN_EXTS = [".md", ".markdown"];
const JSON_EXTS = [".json"];

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

export function parseMarkdownToNote(text: string): Partial<NoteCreate> {
  const normalized = text.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  let title = "";
  let contentStart = 0;
  if (lines[0]?.startsWith("# ")) {
    title = lines[0].slice(2).trim();
    contentStart = 1;
    while (contentStart < lines.length && lines[contentStart].trim() === "") {
      contentStart++;
    }
  }
  const content = lines.slice(contentStart).join("\n").replace(/\s+$/, "");
  return { title, content };
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
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export function isImportableFile(file: File): boolean {
  const ext = fileExtension(file.name);
  if (MARKDOWN_EXTS.includes(ext) || JSON_EXTS.includes(ext)) return true;
  if (file.type === "application/json") return true;
  if (file.type === "text/markdown" || file.type === "text/x-markdown") {
    return true;
  }
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

/**
 * Process one or more files: each file becomes either a new single note
 * (markdown / single-note JSON) or a bulk merge (JSON array).
 */
export async function importFiles(
  files: Iterable<File>,
  handlers: {
    /** Resolves `null` if the note could not be stored. */
    createNote: (input: Partial<NoteCreate>) => Promise<Note | null>;
    /** Resolves `false` if the merge could not be stored. */
    importBulk: (notes: Note[]) => Promise<boolean>;
  },
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    singleCount: 0,
    bulkCount: 0,
    failedCount: 0,
  };
  for (const file of files) {
    if (!isImportableFile(file)) {
      summary.failedCount++;
      continue;
    }
    try {
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
      } else if (await handlers.importBulk(result.notes)) {
        summary.bulkCount += result.notes.length;
      } else {
        summary.failedCount++;
      }
    } catch {
      summary.failedCount++;
    }
  }
  return summary;
}
