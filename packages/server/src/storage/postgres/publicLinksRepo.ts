import {
  PUBLIC_LINK_COLUMNS,
  type PublicLinkRow,
  rowToPublicLink,
} from "../publicLinkMapping.js";
import type { PublicLinksRepo } from "../types.js";
import type { PgPool } from "./database.js";

/** See the SQLite copy: the same statements. */
export function createPostgresPublicLinksRepo(pool: PgPool): PublicLinksRepo {
  return {
    async create(link) {
      await pool.query(
        `INSERT INTO public_links (${PUBLIC_LINK_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          link.token,
          link.noteId,
          link.ownerId,
          link.mode,
          link.snapshot ? JSON.stringify(link.snapshot) : null,
          link.passwordHash,
          link.expiresAt,
          link.maxViews,
          link.viewCount,
          link.lastViewedAt,
          link.createdAt,
          link.canEdit === true,
        ],
      );
    },
    async listByNote(noteId) {
      const result = await pool.query<PublicLinkRow>(
        `SELECT ${PUBLIC_LINK_COLUMNS} FROM public_links WHERE note_id = $1
         ORDER BY created_at DESC, token`,
        [noteId],
      );
      return result.rows.map(rowToPublicLink);
    },
    async get(token) {
      const result = await pool.query<PublicLinkRow>(
        `SELECT ${PUBLIC_LINK_COLUMNS} FROM public_links WHERE token = $1`,
        [token],
      );
      const row = result.rows[0];
      return row ? rowToPublicLink(row) : null;
    },
    async delete(token, noteId) {
      const result = await pool.query(
        `DELETE FROM public_links WHERE token = $1 AND note_id = $2`,
        [token, noteId],
      );
      return (result.rowCount ?? 0) > 0;
    },
    async recordView(token, at) {
      const result = await pool.query(
        `UPDATE public_links
         SET view_count = view_count + 1, last_viewed_at = $2
         WHERE token = $1
           AND (expires_at IS NULL OR expires_at > $2)
           AND (max_views IS NULL OR view_count < max_views)`,
        [token, at],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
