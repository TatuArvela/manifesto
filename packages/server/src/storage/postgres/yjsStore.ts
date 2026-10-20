import type { YjsStore } from "#/storage/types.ts";
import type { PgPool } from "./database.ts";

interface YjsStateRow {
  yjs_state: Buffer | null;
}

export function createPostgresYjsStore(pool: PgPool): YjsStore {
  return {
    async load(noteId: string, ownerId: string): Promise<Buffer | null> {
      const result = await pool.query<YjsStateRow>(
        `SELECT yjs_state FROM notes WHERE id = $1 AND user_id = $2`,
        [noteId, ownerId],
      );
      const row = result.rows[0];
      return row?.yjs_state ?? null;
    },

    async store(
      noteId: string,
      ownerId: string,
      state: Buffer,
      stateVector: Buffer,
    ): Promise<void> {
      // Does NOT change `updated_at`, on purpose. REST optimistic concurrency
      // tracks that field, and Yjs writes must not make the `If-Match` tokens
      // of REST clients invalid.
      await pool.query(
        `UPDATE notes
           SET yjs_state = $1, yjs_state_vector = $2
         WHERE id = $3 AND user_id = $4`,
        [state, stateVector, noteId, ownerId],
      );
    },
  };
}
