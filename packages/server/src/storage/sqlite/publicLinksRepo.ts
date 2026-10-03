import {
  PUBLIC_LINK_COLUMNS,
  type PublicLinkRow,
  rowToPublicLink,
} from "../publicLinkMapping.js";
import type { PublicLinksRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

export function createSqlitePublicLinksRepo(db: SqliteDB): PublicLinksRepo {
  const insertStmt = db.prepare(
    `INSERT INTO public_links (${PUBLIC_LINK_COLUMNS})
     VALUES (@token, @noteId, @ownerId, @mode, @snapshot, @passwordHash,
             @expiresAt, @maxViews, @viewCount, @lastViewedAt, @createdAt,
             @canEdit)`,
  );
  const byNoteStmt = db.prepare(
    `SELECT ${PUBLIC_LINK_COLUMNS} FROM public_links WHERE note_id = ?
     ORDER BY created_at DESC, token`,
  );
  const getStmt = db.prepare(
    `SELECT ${PUBLIC_LINK_COLUMNS} FROM public_links WHERE token = ?`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM public_links WHERE token = ? AND note_id = ?`,
  );
  const viewStmt = db.prepare(
    `UPDATE public_links
     SET view_count = view_count + 1, last_viewed_at = @at
     WHERE token = @token
       AND (expires_at IS NULL OR expires_at > @at)
       AND (max_views IS NULL OR view_count < max_views)`,
  );

  return {
    async create(link) {
      insertStmt.run({
        ...link,
        snapshot: link.snapshot ? JSON.stringify(link.snapshot) : null,
        canEdit: link.canEdit ? 1 : 0,
      });
    },
    async listByNote(noteId) {
      return (byNoteStmt.all(noteId) as PublicLinkRow[]).map(rowToPublicLink);
    },
    async get(token) {
      const row = getStmt.get(token) as PublicLinkRow | undefined;
      return row ? rowToPublicLink(row) : null;
    },
    async delete(token, noteId) {
      return deleteStmt.run(token, noteId).changes > 0;
    },
    async recordView(token, at) {
      return viewStmt.run({ token, at }).changes > 0;
    },
  };
}
