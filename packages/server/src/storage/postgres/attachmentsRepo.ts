import {
  ATTACHMENT_META_COLUMNS,
  type AttachmentRow,
  REFERRING_NOTES_WHERE,
  REFERRING_VERSIONS_SQL,
  type ReferringRow,
  referencesOf,
  refPattern,
  rowToAttachmentMeta,
  rowToStoredAttachment,
  sweepAction,
} from "#/storage/attachmentMapping.ts";
import {
  snapshotReferences,
  usableSnapshotsWhere,
} from "#/storage/publicLinkMapping.ts";
import type { AttachmentsRepo } from "#/storage/types.ts";
import type { PgPool } from "./database.ts";

/** See the SQLite copy: the same statements, and the same sweep. */
export function createPostgresAttachmentsRepo(pool: PgPool): AttachmentsRepo {
  async function meta(id: string) {
    const result = await pool.query<AttachmentRow>(
      `SELECT ${ATTACHMENT_META_COLUMNS} FROM attachments WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? rowToAttachmentMeta(row) : null;
  }

  return {
    async put(input) {
      await pool.query(
        `INSERT INTO attachments
           (id, owner_id, sha256, content_type, size, data, created_at,
            wrapped_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (owner_id, sha256) DO UPDATE SET unreferenced_since = NULL`,
        [
          input.id,
          input.ownerId,
          input.sha256,
          input.contentType,
          input.data.length,
          input.data,
          input.createdAt,
          input.wrappedKey ?? null,
        ],
      );
      const result = await pool.query<AttachmentRow>(
        `SELECT ${ATTACHMENT_META_COLUMNS} FROM attachments
         WHERE owner_id = $1 AND sha256 = $2`,
        [input.ownerId, input.sha256],
      );
      return rowToAttachmentMeta(result.rows[0] as AttachmentRow);
    },

    async get(id) {
      const result = await pool.query<AttachmentRow>(
        `SELECT * FROM attachments WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? rowToStoredAttachment(row) : null;
    },

    meta,

    async readableBy(id, userId) {
      const found = await meta(id);
      if (!found) return false;
      if (found.ownerId === userId) return true;
      const shared = await pool.query<ReferringRow>(
        `SELECT n.images, n.preview_refs
         FROM note_shares s JOIN notes n ON n.id = s.note_id
         WHERE s.user_id = $1 AND s.accepted_at IS NOT NULL
           AND n.user_id = $2 AND n.trashed = FALSE
           AND (n.images LIKE $3 OR n.preview_refs LIKE $3)`,
        [userId, found.ownerId, refPattern(id)],
      );
      // The versions of the same shared notes: a reader of a note reads its
      // history, with the pictures that it had.
      const versions = await pool.query<ReferringRow>(
        `SELECT v.image_refs AS images, NULL AS preview_refs
         FROM note_shares s JOIN notes n ON n.id = s.note_id
           JOIN note_versions v ON v.note_id = n.id
         WHERE s.user_id = $1 AND s.accepted_at IS NOT NULL
           AND n.user_id = $2 AND n.trashed = FALSE
           AND v.image_refs LIKE $3`,
        [userId, found.ownerId, refPattern(id)],
      );
      return [...shared.rows, ...versions.rows].some((note) =>
        referencesOf(note).includes(id),
      );
    },

    async sweep(now, cutoffIso) {
      const referenced = new Set<string>();
      const notes = await pool.query<ReferringRow>(
        `SELECT images, preview_refs FROM notes WHERE ${REFERRING_NOTES_WHERE}`,
      );
      const versions = await pool.query<ReferringRow>(REFERRING_VERSIONS_SQL);
      for (const row of [...notes.rows, ...versions.rows]) {
        for (const id of referencesOf(row)) referenced.add(id);
      }
      const snapshots = await pool.query<{ snapshot: string }>(
        `SELECT snapshot FROM public_links WHERE ${usableSnapshotsWhere("$1")}`,
        [now],
      );
      for (const row of snapshots.rows) {
        for (const id of snapshotReferences(row.snapshot)) referenced.add(id);
      }
      const rows = await pool.query<{
        id: string;
        unreferenced_since: string | null;
      }>(`SELECT id, unreferenced_since FROM attachments`);
      let deleted = 0;
      for (const row of rows.rows) {
        const action = sweepAction(
          referenced.has(row.id),
          row.unreferenced_since,
          cutoffIso,
        );
        if (action === "clear" || action === "mark") {
          await pool.query(
            `UPDATE attachments SET unreferenced_since = $1 WHERE id = $2`,
            [action === "mark" ? now : null, row.id],
          );
        } else if (action === "delete") {
          // Only if it is still unreferenced. A note can have taken it again
          // after the scan above.
          const gone = await pool.query(
            `DELETE FROM attachments WHERE id = $1 AND NOT EXISTS
               (SELECT 1 FROM notes
                WHERE images LIKE $2 OR preview_refs LIKE $2)
             AND NOT EXISTS
               (SELECT 1 FROM note_versions WHERE image_refs LIKE $2)`,
            [row.id, refPattern(row.id)],
          );
          deleted += gone.rowCount ?? 0;
        }
      }
      return deleted;
    },
  };
}
