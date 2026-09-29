import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { ulid } from "ulid";

/**
 * The most any one import reads. A multi-gigabyte drop would otherwise lock
 * the tab inside the browser's own parser before any code here runs.
 */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** Refuses a file over the import limit before a byte of it is read. */
export function checkImportSize(file: File): void {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`File exceeds ${MAX_IMPORT_BYTES} bytes`);
  }
}

/**
 * One way in from another notes app. Each format is recognised by its
 * contents, not only its name, so a renamed file still imports and a file
 * that only looks like one is left to the next importer.
 *
 * - `fromFile` takes a whole file of the format (`.enex`, `.jex`, `.html`).
 * - `fromJson` takes a JSON document already parsed, wherever it was found:
 *   picked on its own, or inside an archive (Simplenote's export is a zip
 *   with its JSON in `source/`).
 *
 * Either resolves the notes, or null when the input is not this format.
 * An importer throws only for a file that is its format and cannot be read
 * (an encrypted backup), which the caller counts as one failed file.
 */
export interface Importer {
  format: string;
  /** File extensions `fromFile` is offered, lower case with the dot. */
  extensions: readonly string[];
  fromFile?(file: File): Promise<Note[] | null>;
  fromJson?(data: unknown): Promise<Note[] | null> | Note[] | null;
}

/** The fields an importer knows; everything else takes a new note's value. */
export interface ImportedFields {
  title?: string;
  content?: string;
  tags?: string[];
  images?: string[];
  pinned?: boolean;
  archived?: boolean;
  trashed?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** A whole note from what an importer read, dated as the source dated it. */
export function importedNote(
  fields: ImportedFields,
  now: string = new Date().toISOString(),
): Note {
  const valid = (iso: string | null | undefined) =>
    iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString() : null;
  const updatedAt = valid(fields.updatedAt) ?? valid(fields.createdAt) ?? now;
  const createdAt = valid(fields.createdAt) ?? updatedAt;
  const trashed = fields.trashed === true;
  return {
    id: ulid(),
    title: (fields.title ?? "").trim(),
    content: (fields.content ?? "").trimEnd(),
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: fields.pinned === true,
    archived: fields.archived === true,
    trashed,
    // No source records when a note was trashed; the 30 days start now.
    trashedAt: trashed ? now : null,
    // Newest first in the manual order, as notes made here are.
    position: -(Date.parse(createdAt) || Date.now()),
    tags: [
      ...new Set(
        (fields.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag),
      ),
    ],
    images: fields.images ?? [],
    linkPreviews: [],
    reminder: null,
    createdAt,
    updatedAt,
  };
}

/** A note with no title of its own takes its first line as one. */
export function splitTitle(text: string): { title: string; content: string } {
  const trimmed = text.replace(/^﻿/, "").replace(/^\s*\n/, "");
  const end = trimmed.indexOf("\n");
  if (end === -1) return { title: trimmed.trim(), content: "" };
  return {
    title: trimmed
      .slice(0, end)
      .replace(/^#+\s*/, "")
      .trim(),
    content: trimmed.slice(end + 1).replace(/^\s*\n/, ""),
  };
}
