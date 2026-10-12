import { attachmentIdOf, isAttachmentRef } from "@manifesto/shared";
import { parseJson } from "./noteMapping.js";
import type { AttachmentMeta, StoredAttachment } from "./types.js";

export interface AttachmentRow {
  id: string;
  owner_id: string;
  sha256: string;
  content_type: string;
  size: number | string;
  created_at: string;
  data?: Buffer | Uint8Array;
}

export const ATTACHMENT_META_COLUMNS =
  "id, owner_id, sha256, content_type, size, created_at";

export function rowToAttachmentMeta(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sha256: row.sha256,
    contentType: row.content_type,
    size: Number(row.size),
    createdAt: row.created_at,
  };
}

export function rowToStoredAttachment(row: AttachmentRow): StoredAttachment {
  return {
    ...rowToAttachmentMeta(row),
    data: Buffer.from(row.data ?? new Uint8Array()),
  };
}

/** The attachment ids a column of references (`images`, `preview_refs`)
 * names. */
export function referencedIds(imagesJson: string | null): string[] {
  const parsed = parseJson<unknown>(imagesJson, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((i): i is string => typeof i === "string" && isAttachmentRef(i))
    .map(attachmentIdOf);
}

/**
 * A note row's two columns of attachment references: those of its images and
 * those of its link previews' thumbnails and icons. The note itself names
 * them inside ciphertext, so these are what the server knows.
 */
export interface ReferringRow {
  images: string;
  preview_refs: string;
}

/** Selects the notes that refer to any attachment at all. */
export const REFERRING_NOTES_WHERE =
  "(images LIKE '%attachment:%' OR preview_refs LIKE '%attachment:%')";

/** Every attachment id a note row refers to, from its images and previews. */
export function referencesOf(row: ReferringRow): string[] {
  return [...referencedIds(row.images), ...referencedIds(row.preview_refs)];
}

/** The `LIKE` pattern finding a note whose images refer to `id`. ULIDs hold
 * no wildcard, so nothing needs escaping. */
export function refPattern(id: string): string {
  return `%attachment:${id}%`;
}

/**
 * The sweep's decision for one attachment, the same in both drivers: clear
 * the mark on one referred to, mark one newly unreferenced, delete one
 * unreferenced since before the cutoff.
 */
export function sweepAction(
  referenced: boolean,
  unreferencedSince: string | null,
  cutoffIso: string,
): "clear" | "mark" | "delete" | null {
  if (referenced) return unreferencedSince === null ? null : "clear";
  if (unreferencedSince === null) return "mark";
  return unreferencedSince < cutoffIso ? "delete" : null;
}
