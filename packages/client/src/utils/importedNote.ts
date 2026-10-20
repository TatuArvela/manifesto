import type {
  Note,
  NoteCreate,
  NoteReminder,
  NoteVersion,
} from "@manifesto/shared";
import {
  MAX_IMAGE_ALT_LENGTH,
  NoteColor,
  NoteFont,
  REMINDER_RECURRENCES,
} from "@manifesto/shared";
import { ulid } from "ulid";
import {
  frontmatterBoolean,
  frontmatterDate,
  frontmatterList,
  frontmatterString,
  splitFrontmatter,
} from "./frontmatter.ts";
import { parseLinkPreviews } from "./linkPreview.ts";

// The change of the content of a file into notes: a Markdown file, the JSON of
// this app (one note or an array), and the versions of an export. Each value is
// only what the file says. Thus, the code checks each one, and an unknown value
// falls back.

export type ImportResult =
  | { kind: "single"; note: Partial<NoteCreate> }
  | { kind: "bulk"; notes: Note[] };

/**
 * One Markdown file as a note. YAML frontmatter, as Obsidian and other Markdown
 * note apps write it (and the own export of this app), can give the title,
 * `tags` (or `tag`) and the pinned and archived flags. A `title` there wins,
 * also an empty one. A leading heading is then the own content of the note, and
 * is dropped only when it repeats the title. With no `title`, a leading `# `
 * heading is the title, and goes out of the body.
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
    while (lines[contentStart]?.trim() === "") {
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
 * file, and do not give it a heading. Thus, the file name is the fallback
 * title, and the folders in which it is (the categories of Nextcloud Notes, the
 * directories of an Obsidian vault) become tags.
 */
export function markdownFileToNote(
  path: string,
  text: string,
  now: string = new Date().toISOString(),
): Note {
  const note = parseMarkdownToNote(text);
  const { data } = splitFrontmatter(text.replace(/^\uFEFF/, ""));
  // An empty `title:` says that the note has none, as the export of this app
  // writes an untitled note. Only a file that does not tell gets its own name.
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
/**
 * What the server requires of the id of an imported note (`notesImportSchema`).
 */
const NOTE_ID = /^[0-9A-Za-z_-]{1,64}$/;

function parseReminder(raw: unknown): NoteReminder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const reminder = raw as Record<string, unknown>;
  if (typeof reminder.time !== "string") return null;
  return {
    time: reminder.time,
    recurrence:
      typeof reminder.recurrence === "string" &&
      RECURRENCES.has(reminder.recurrence)
        ? (reminder.recurrence as NoteReminder["recurrence"])
        : "none",
    ...(Number.isInteger(reminder.day) &&
    Number(reminder.day) >= 1 &&
    Number(reminder.day) <= 31
      ? { day: Number(reminder.day) }
      : {}),
    timezone: typeof reminder.timezone === "string" ? reminder.timezone : "UTC",
    ...(typeof reminder.lastFiredAt === "string"
      ? { lastFiredAt: reminder.lastFiredAt }
      : {}),
  };
}

function parseStringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Changes an import item whose shape passed the check into a complete `Note`
 * that can render.
 *
 * An unknown `color` must never reach storage. It would reach
 * `noteColorMap[...]` as `undefined`, and throw inside `NoteCard` on each load
 * after it was persisted. `isValidNoteShape` checked that the identity fields
 * are strings, and no more than that. The code replaces an id that could not be
 * one of ours (it becomes a path segment and a storage key). A date that is not
 * a date becomes the time of the import. All other values are validated, and
 * fall back to a safe default.
 */
export function normalizeImportedNote(
  raw: Record<string, unknown>,
  now: string = new Date().toISOString(),
): Note {
  const date = (value: unknown): string | null =>
    typeof value === "string" && !Number.isNaN(Date.parse(value))
      ? value
      : null;
  const updatedAt = date(raw.updatedAt) ?? date(raw.createdAt) ?? now;
  const trashed = raw.trashed === true;
  const images = parseStringArray(raw.images);
  const imageAlts = parseImageAlts(raw.imageAlts, images.length);
  return {
    id: typeof raw.id === "string" && NOTE_ID.test(raw.id) ? raw.id : ulid(),
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
    trashed,
    // A trashed note with no trash date would never expire.
    trashedAt: trashed ? (date(raw.trashedAt) ?? now) : null,
    position:
      typeof raw.position === "number" && Number.isFinite(raw.position)
        ? raw.position
        : -Date.now(),
    tags: parseStringArray(raw.tags),
    images,
    ...(imageAlts && { imageAlts }),
    linkPreviews: parseLinkPreviews(raw.linkPreviews),
    reminder: parseReminder(raw.reminder),
    createdAt: date(raw.createdAt) ?? updatedAt,
    updatedAt,
  };
}

/**
 * The descriptions of the images of the note in a file, one for each image: ""
 * for a description that is missing, is not text, or is too long. Undefined
 * when none is left.
 */
function parseImageAlts(raw: unknown, count: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const alts = Array.from({ length: count }, (_, i) => {
    const alt: unknown = raw[i];
    return typeof alt === "string" && alt.length <= MAX_IMAGE_ALT_LENGTH
      ? alt
      : "";
  });
  return alts.some((alt) => alt !== "") ? alts : undefined;
}

export function isValidNoteShape(item: unknown): item is Note {
  if (typeof item !== "object" || item === null) return false;
  const note = item as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    typeof note.content === "string" &&
    typeof note.createdAt === "string" &&
    typeof note.updatedAt === "string" &&
    Array.isArray(note.tags)
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
    const imageAlts = parseImageAlts(raw.imageAlts, out.images.length);
    if (imageAlts) out.imageAlts = imageAlts;
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
 * A version from the `versions.json` of an export, which is only what the file
 * says. The code drops all that does not have the shape of a version, and does
 * not file it.
 */
export function isNoteVersion(value: unknown): value is NoteVersion {
  if (typeof value !== "object" || value === null) return false;
  const version = value as Record<string, unknown>;
  return (
    typeof version.noteId === "string" &&
    typeof version.title === "string" &&
    typeof version.content === "string" &&
    typeof version.timestamp === "string" &&
    !Number.isNaN(Date.parse(version.timestamp))
  );
}
