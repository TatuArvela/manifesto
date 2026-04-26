import type { YjsStore } from "../types.js";
import type { PgPool } from "./database.js";

interface YjsStateRow {
  yjs_state: Buffer | null;
}

export function createPostgresYjsStore(pool: PgPool): YjsStore {
  return {
    async load(noteId: string, userId: string): Promise<Buffer | null> {
      const result = await pool.query<YjsStateRow>(
        `SELECT yjs_state FROM notes WHERE id = $1 AND user_id = $2`,
        [noteId, userId],
      );
      const row = result.rows[0];
      return row?.yjs_state ?? null;
    },

    async store(
      noteId: string,
      userId: string,
      state: Buffer,
      stateVector: Buffer,
      updatedAt: string,
    ): Promise<void> {
      await pool.query(
        `UPDATE notes
           SET yjs_state = $1, yjs_state_vector = $2, updated_at = $3
         WHERE id = $4 AND user_id = $5`,
        [state, stateVector, updatedAt, noteId, userId],
      );
    },
  };
}
