import {
  ATTACHMENT_META_COLUMNS,
  type AttachmentRow,
  referencedIds,
  refPattern,
  rowToAttachmentMeta,
  rowToStoredAttachment,
  sweepAction,
} from "../attachmentMapping.js";
import { parseJson } from "../noteMapping.js";
import type { AttachmentsRepo } from "../types.js";
import type { PgPool } from "./database.js";

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
           (id, owner_id, sha256, content_type, size, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (owner_id, sha256) DO NOTHING`,
        [
          input.id,
          input.ownerId,
          input.sha256,
          input.contentType,
          input.data.length,
          input.data,
          input.createdAt,
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
      const shared = await pool.query(
        `SELECT n.id FROM note_shares s JOIN notes n ON n.id = s.note_id
         WHERE s.user_id = $1 AND s.accepted_at IS NOT NULL
           AND n.user_id = $2 AND n.trashed = FALSE AND n.images LIKE $3
         LIMIT 1`,
        [userId, found.ownerId, refPattern(id)],
      );
      return shared.rows.length > 0;
    },

    async sweep(now, cutoffIso) {
      const referenced = new Set<string>();
      const notes = await pool.query<{ images: string }>(
        `SELECT images FROM notes WHERE images LIKE '%attachment:%'`,
      );
      for (const row of notes.rows) {
        for (const id of referencedIds(row.images)) referenced.add(id);
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
          // Only if it is still unreferenced: a note may have taken it up
          // again since the scan above.
          const gone = await pool.query(
            `DELETE FROM attachments WHERE id = $1 AND NOT EXISTS
               (SELECT 1 FROM notes WHERE images LIKE $2)`,
            [row.id, refPattern(row.id)],
          );
          deleted += gone.rowCount ?? 0;
        }
      }
      return deleted;
    },

    async notesWithInlineImages(limit) {
      const result = await pool.query<{
        id: string;
        user_id: string;
        images: string;
      }>(
        `SELECT id, user_id, images FROM notes
         WHERE images LIKE '%"data:%' LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        id: row.id,
        ownerId: row.user_id,
        images: parseJson<string[]>(row.images, []),
      }));
    },

    async setNoteImages(id, images) {
      await pool.query(`UPDATE notes SET images = $1 WHERE id = $2`, [
        JSON.stringify(images),
        id,
      ]);
    },
  };
}
