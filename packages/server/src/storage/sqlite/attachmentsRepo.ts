import {
  ATTACHMENT_META_COLUMNS,
  type AttachmentRow,
  referencedIds,
  refPattern,
  rowToAttachmentMeta,
  rowToStoredAttachment,
  sweepAction,
} from "../attachmentMapping.js";
import type { AttachmentsRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqliteAttachmentsRepo(db: SqliteDB): AttachmentsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO attachments
       (id, owner_id, sha256, content_type, size, data, created_at)
     VALUES (@id, @ownerId, @sha256, @contentType, @size, @data, @createdAt)
     ON CONFLICT (owner_id, sha256) DO NOTHING`,
  );
  const byHashStmt = db.prepare(
    `SELECT ${ATTACHMENT_META_COLUMNS} FROM attachments
     WHERE owner_id = ? AND sha256 = ?`,
  );
  const getStmt = db.prepare(`SELECT * FROM attachments WHERE id = ?`);
  const metaStmt = db.prepare(
    `SELECT ${ATTACHMENT_META_COLUMNS} FROM attachments WHERE id = ?`,
  );
  const sharedRefStmt = db.prepare(
    `SELECT 1 FROM note_shares s JOIN notes n ON n.id = s.note_id
     WHERE s.user_id = ? AND s.accepted_at IS NOT NULL
       AND n.user_id = ? AND n.trashed = 0 AND n.images LIKE ?
     LIMIT 1`,
  );
  const referringStmt = db.prepare(
    `SELECT images FROM notes WHERE images LIKE '%attachment:%'`,
  );
  const allStmt = db.prepare(`SELECT id, unreferenced_since FROM attachments`);
  const markStmt = db.prepare(
    `UPDATE attachments SET unreferenced_since = ? WHERE id = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM attachments WHERE id = ?`);

  const sweep = db.transaction((now: string, cutoffIso: string) => {
    const referenced = new Set<string>();
    for (const row of referringStmt.all() as { images: string }[]) {
      for (const id of referencedIds(row.images)) referenced.add(id);
    }
    let deleted = 0;
    const rows = allStmt.all() as {
      id: string;
      unreferenced_since: string | null;
    }[];
    for (const row of rows) {
      switch (
        sweepAction(referenced.has(row.id), row.unreferenced_since, cutoffIso)
      ) {
        case "clear":
          markStmt.run(null, row.id);
          break;
        case "mark":
          markStmt.run(now, row.id);
          break;
        case "delete":
          deleteStmt.run(row.id);
          deleted++;
          break;
      }
    }
    return deleted;
  });

  return {
    async put(input) {
      insertStmt.run({ ...input, size: input.data.length });
      const row = byHashStmt.get(input.ownerId, input.sha256) as AttachmentRow;
      return rowToAttachmentMeta(row);
    },

    async get(id) {
      const row = getStmt.get(id) as AttachmentRow | undefined;
      return row ? rowToStoredAttachment(row) : null;
    },

    async meta(id) {
      const row = metaStmt.get(id) as AttachmentRow | undefined;
      return row ? rowToAttachmentMeta(row) : null;
    },

    async readableBy(id, userId) {
      const row = metaStmt.get(id) as AttachmentRow | undefined;
      if (!row) return false;
      if (row.owner_id === userId) return true;
      return (
        sharedRefStmt.get(userId, row.owner_id, refPattern(id)) !== undefined
      );
    },

    async sweep(now, cutoffIso) {
      return sweep(now, cutoffIso);
    },
  };
}
