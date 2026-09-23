import type { Note } from "@manifesto/shared";
import {
  IMAGE_DATA_URL_SUBTYPES,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_IMAGES_PER_NOTE,
  NoteColor,
  NoteFont,
} from "@manifesto/shared";
import { ulid } from "ulid";
import { parseLinkPreviews } from "./linkPreview.js";

/**
 * Google Keep, as Google Takeout exports it: one JSON file per note in
 * `Takeout/Keep/`, with its attachments as sibling files named by
 * `attachments[].filePath`. The format is undocumented, so every field is
 * optional here and a file is recognised by the fields only Keep writes.
 */

const KEEP_COLORS: Record<string, NoteColor> = {
  DEFAULT: NoteColor.Default,
  RED: NoteColor.Red,
  ORANGE: NoteColor.Orange,
  YELLOW: NoteColor.Yellow,
  GREEN: NoteColor.Green,
  TEAL: NoteColor.Teal,
  BLUE: NoteColor.Blue,
  // Keep's darker blue ("Storm"); the palette has one blue.
  CERULEAN: NoteColor.Blue,
  PURPLE: NoteColor.Purple,
  PINK: NoteColor.Pink,
  BROWN: NoteColor.Brown,
  GRAY: NoteColor.Gray,
};

const IMAGE_SUBTYPES = new Set<string>(IMAGE_DATA_URL_SUBTYPES);

export function isKeepNote(data: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const d = data as Record<string, unknown>;
  return (
    typeof d.userEditedTimestampUsec === "number" &&
    typeof d.isTrashed === "boolean" &&
    (typeof d.textContent === "string" || Array.isArray(d.listContent))
  );
}

/** Looks up an attachment's bytes by the name Keep recorded for it. */
export type AttachmentLookup = (
  filePath: string,
) => Promise<Uint8Array | null> | Uint8Array | null;

function usecToIso(raw: unknown, fallback: string): string {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  const ms = Math.floor(raw / 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/**
 * Keep's checklist items become a GFM task list, the form the editor already
 * renders as checkboxes. Line breaks inside one item would split it into
 * several, so they fold to spaces.
 */
function listToMarkdown(items: unknown[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const i = item as Record<string, unknown>;
    const text =
      typeof i.text === "string" ? i.text.replace(/\s*\r?\n\s*/g, " ") : "";
    lines.push(`- [${i.isChecked === true ? "x" : " "}] ${text}`.trimEnd());
  }
  return lines.join("\n");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function attachmentsToImages(
  raw: unknown,
  lookup: AttachmentLookup,
): Promise<string[]> {
  if (!Array.isArray(raw)) return [];
  const images: string[] = [];
  for (const item of raw) {
    if (images.length >= MAX_IMAGES_PER_NOTE) break;
    if (typeof item !== "object" || item === null) continue;
    const a = item as Record<string, unknown>;
    if (typeof a.filePath !== "string" || typeof a.mimetype !== "string") {
      continue;
    }
    // Keep also attaches voice recordings (audio/3gp); only images have a
    // place on a note.
    const match = /^image\/([a-z0-9+.-]+)$/i.exec(a.mimetype);
    const subtype = match?.[1].toLowerCase();
    if (!subtype || !IMAGE_SUBTYPES.has(subtype)) continue;
    const bytes = await lookup(a.filePath);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_IMAGE_SOURCE_BYTES) {
      continue;
    }
    images.push(`data:image/${subtype};base64,${bytesToBase64(bytes)}`);
  }
  return images;
}

export async function keepNoteToNote(
  data: Record<string, unknown>,
  lookup: AttachmentLookup,
  now: string = new Date().toISOString(),
): Promise<Note> {
  const text =
    typeof data.textContent === "string" ? data.textContent.trimEnd() : "";
  const list = Array.isArray(data.listContent)
    ? listToMarkdown(data.listContent)
    : "";
  const content = [text, list].filter(Boolean).join("\n\n");
  const updatedAt = usecToIso(data.userEditedTimestampUsec, now);
  const createdAt = usecToIso(data.createdTimestampUsec, updatedAt);
  const tags = Array.isArray(data.labels)
    ? [
        ...new Set(
          data.labels
            .map((l) =>
              typeof l === "object" && l !== null
                ? (l as Record<string, unknown>).name
                : undefined,
            )
            .filter(
              (n): n is string => typeof n === "string" && n.trim() !== "",
            )
            .map((n) => n.trim()),
        ),
      ]
    : [];
  const trashed = data.isTrashed === true;
  return {
    id: ulid(),
    title: typeof data.title === "string" ? data.title.trim() : "",
    content,
    color:
      typeof data.color === "string" && Object.hasOwn(KEEP_COLORS, data.color)
        ? KEEP_COLORS[data.color]
        : NoteColor.Default,
    font: NoteFont.Default,
    pinned: data.isPinned === true,
    archived: data.isArchived === true,
    trashed,
    // Keep does not record when a note was trashed. Starting the 30 days now
    // gives the user the full window to change their mind after importing.
    trashedAt: trashed ? now : null,
    position: Date.parse(createdAt) || Date.now(),
    tags,
    images: await attachmentsToImages(data.attachments, lookup),
    linkPreviews: parseLinkPreviews(
      Array.isArray(data.annotations)
        ? data.annotations.filter(
            (a) =>
              typeof a === "object" &&
              a !== null &&
              (a as Record<string, unknown>).source === "WEBLINK",
          )
        : [],
    ),
    reminder: null,
    createdAt,
    updatedAt,
  };
}
