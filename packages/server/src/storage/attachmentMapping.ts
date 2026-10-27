import { attachmentIdOf, isAttachmentRef } from "@manifesto/shared";
import { parseJson } from "./noteMapping.ts";
import type { AttachmentMeta, StoredAttachment } from "./types.ts";

export interface AttachmentRow {
  id: string;
  owner_id: string;
  sha256: string;
  content_type: string;
  size: number | string;
  created_at: string;
  wrapped_key?: string | null;
  data?: Buffer | Uint8Array;
}

export const ATTACHMENT_META_COLUMNS =
  "id, owner_id, sha256, content_type, size, created_at, wrapped_key";

export function rowToAttachmentMeta(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sha256: row.sha256,
    contentType: row.content_type,
    size: Number(row.size),
    createdAt: row.created_at,
    wrappedKey: row.wrapped_key ?? null,
  };
}

export function rowToStoredAttachment(row: AttachmentRow): StoredAttachment {
  return {
    ...rowToAttachmentMeta(row),
    data: Buffer.from(row.data ?? new Uint8Array()),
  };
}

/**
 * The attachment ids that a column of references (`images`, `preview_refs`)
 * names.
 */
export function referencedIds(imagesJson: string | null): string[] {
  const parsed = parseJson<unknown>(imagesJson, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((i): i is string => typeof i === "string" && isAttachmentRef(i))
    .map(attachmentIdOf);
}

/**
 * The two columns of attachment references of a note row: those of its images,
 * and those of the thumbnails and icons of its link previews. The note itself
 * names them inside ciphertext. Thus, these are what the server knows.
 */
export interface ReferringRow {
  images: string | null;
  preview_refs: string | null;
}

/** Selects the notes that refer to an attachment. */
export const REFERRING_NOTES_WHERE =
  "(images LIKE '%attachment:%' OR preview_refs LIKE '%attachment:%')";

/**
 * The versions that refer to an attachment, in the shape of a note row. A
 * version keeps the images of the note before an edit. Thus, a restore within
 * its life still finds them.
 */
export const REFERRING_VERSIONS_SQL =
  "SELECT image_refs AS images, NULL AS preview_refs FROM note_versions WHERE image_refs LIKE '%attachment:%'";

/**
 * Each attachment id to which a note row refers, from its images and previews.
 */
export function referencesOf(row: ReferringRow): string[] {
  return [...referencedIds(row.images), ...referencedIds(row.preview_refs)];
}

/**
 * The `LIKE` pattern that finds a note whose images refer to `id`. ULIDs
 * contain no wildcard. Thus, nothing needs an escape.
 */
export function refPattern(id: string): string {
  return `%attachment:${id}%`;
}

/**
 * The decision of the sweep for one attachment, the same in both drivers: clear
 * the mark on an attachment to which a note refers, mark an attachment that has
 * become unreferenced, delete an attachment that is unreferenced since before
 * the cutoff.
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
