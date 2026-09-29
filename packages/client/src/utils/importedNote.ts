import type {
  Note,
  NoteCreate,
  NoteReminder,
  NoteVersion,
} from "@manifesto/shared";
import { NoteColor, NoteFont, REMINDER_RECURRENCES } from "@manifesto/shared";
import { ulid } from "ulid";
import {
  frontmatterBoolean,
  frontmatterDate,
  frontmatterList,
  frontmatterString,
  splitFrontmatter,
} from "./frontmatter.js";
import { parseLinkPreviews } from "./linkPreview.js";

// Turning what a file holds into notes: a Markdown file, this app's JSON (one
// note or an array), and the versions of an export. Every value is the file's
// word only, so each is checked and anything unrecognised falls back.

export type ImportResult =
  | { kind: "single"; note: Partial<NoteCreate> }
  | { kind: "bulk"; notes: Note[] };

/**
 * One Markdown file as a note. YAML frontmatter, as Obsidian and other
 * Markdown note apps write it (and this app's own export), can give the
 * title, `tags` (or `tag`) and the pinned / archived flags. A `title` there
 * wins, even an empty one: a leading heading is then the note's own content,
 * and is dropped only when it repeats the title. With no `title`, a leading
 * `# ` heading is the title and leaves the body.
 */
export function parseMarkdownToNote(text: string): Partial<NoteCreate> {
  const { data, body } = splitFrontmatter(text.replace(/^\uFEFF/, ""));
  const lines = body.split(/\r?\n/);
  const titled = typeof data.title === "string";
  let title = frontmatterString(data.title) ?? "";
  let contentStart = 0;
  const heading = lines[0]?.startsWith("# ") ? lines[0].slice(2).trim() : null;
  if (heading !== null && (!titled || (title !== "" && heading === title))) {
    title = heading;
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
  // An empty `title:` says the note has none, as this app's export writes an
  // untitled note; only a file that does not say is named after itself.
  const titled = typeof data.title === "string";
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
    title: titled ? (note.title ?? "") : note.title || stem,
    tags: [...new Set([...(note.tags ?? []), ...segments])],
    // Newest first, as notes written here are.
    position: -Date.parse(createdAt),
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
 * An unknown `color` must never reach storage: it would reach
 * `noteColorMap[...]` as `undefined` and throw inside `NoteCard` on every load
 * after it was persisted. Identity fields are trusted (`isValidNoteShape` has already checked them);
 * everything else is validated and falls back to a safe default.
 */
export function normalizeImportedNote(raw: Record<string, unknown>): Note {
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
        : -Date.now(),
    tags: parseStringArray(raw.tags),
    images: parseStringArray(raw.images),
    linkPreviews: parseLinkPreviews(raw.linkPreviews),
    reminder: parseReminder(raw.reminder),
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

export function isValidNoteShape(item: unknown): item is Note {
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

/**
 * A version from an export's `versions.json`, which is only the file's word:
 * anything not shaped like one is dropped rather than filed.
 */
export function isNoteVersion(value: unknown): value is NoteVersion {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.noteId === "string" &&
    typeof v.title === "string" &&
    typeof v.content === "string" &&
    typeof v.timestamp === "string" &&
    !Number.isNaN(Date.parse(v.timestamp))
  );
}
