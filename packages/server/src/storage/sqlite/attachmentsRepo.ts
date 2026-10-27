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
import type { SqliteDB } from "./database.ts";

export function createSqliteAttachmentsRepo(db: SqliteDB): AttachmentsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO attachments
       (id, owner_id, sha256, content_type, size, data, created_at,
        wrapped_key)
     VALUES (@id, @ownerId, @sha256, @contentType, @size, @data, @createdAt,
        @wrappedKey)
     ON CONFLICT (owner_id, sha256) DO UPDATE SET unreferenced_since = NULL`,
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
    `SELECT n.images, n.preview_refs
     FROM note_shares s JOIN notes n ON n.id = s.note_id
     WHERE s.user_id = @userId AND s.accepted_at IS NOT NULL
       AND n.user_id = @ownerId AND n.trashed = 0
       AND (n.images LIKE @pattern OR n.preview_refs LIKE @pattern)`,
  );
  // The versions of the same shared notes: a reader of a note reads its
  // history, with the pictures that it had.
  const sharedVersionRefStmt = db.prepare(
    `SELECT v.image_refs AS images, NULL AS preview_refs
     FROM note_shares s JOIN notes n ON n.id = s.note_id
       JOIN note_versions v ON v.note_id = n.id
     WHERE s.user_id = @userId AND s.accepted_at IS NOT NULL
       AND n.user_id = @ownerId AND n.trashed = 0
       AND v.image_refs LIKE @pattern`,
  );
  const referringVersionsStmt = db.prepare(REFERRING_VERSIONS_SQL);
  const referringStmt = db.prepare(
    `SELECT images, preview_refs FROM notes WHERE ${REFERRING_NOTES_WHERE}`,
  );
  const snapshotsStmt = db.prepare(
    `SELECT snapshot FROM public_links WHERE ${usableSnapshotsWhere("?")}`,
  );
  const allStmt = db.prepare(`SELECT id, unreferenced_since FROM attachments`);
  const markStmt = db.prepare(
    `UPDATE attachments SET unreferenced_since = ? WHERE id = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM attachments WHERE id = ?`);

  const sweep = db.transaction((now: string, cutoffIso: string) => {
    const referenced = new Set<string>();
    for (const row of [
      ...(referringStmt.all() as ReferringRow[]),
      ...(referringVersionsStmt.all() as ReferringRow[]),
    ]) {
      for (const id of referencesOf(row)) referenced.add(id);
    }
    // A snapshot link shows the note as it was, also pictures that the note
    // removed after that.
    for (const row of snapshotsStmt.all(now) as { snapshot: string }[]) {
      for (const id of snapshotReferences(row.snapshot)) referenced.add(id);
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
      insertStmt.run({
        ...input,
        size: input.data.length,
        wrappedKey: input.wrappedKey ?? null,
      });
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
      const asked = { userId, ownerId: row.owner_id, pattern: refPattern(id) };
      const candidates = [
        ...(sharedRefStmt.all(asked) as ReferringRow[]),
        ...(sharedVersionRefStmt.all(asked) as ReferringRow[]),
      ];
      return candidates.some((note) => referencesOf(note).includes(id));
    },

    async sweep(now, cutoffIso) {
      return sweep(now, cutoffIso);
    },
  };
}
