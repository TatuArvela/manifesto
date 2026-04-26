import type { YjsStore } from "../types.js";
import type { SqliteDB } from "./database.js";

interface YjsStateRow {
  yjs_state: Buffer | null;
}

export function createSqliteYjsStore(db: SqliteDB): YjsStore {
  const fetchStmt = db.prepare(
    `SELECT yjs_state FROM notes
     WHERE id = ? AND user_id = ?`,
  );
  // Intentionally does NOT touch `updated_at` — REST optimistic concurrency
  // tracks that field and Yjs writes shouldn't invalidate concurrent
  // `If-Match` tokens held by REST clients.
  const storeStmt = db.prepare(
    `UPDATE notes
       SET yjs_state = @state,
           yjs_state_vector = @stateVector
     WHERE id = @id AND user_id = @userId`,
  );

  return {
    async load(noteId: string, userId: string): Promise<Buffer | null> {
      const row = fetchStmt.get(noteId, userId) as YjsStateRow | undefined;
      return row?.yjs_state ?? null;
    },

    async store(
      noteId: string,
      userId: string,
      state: Buffer,
      stateVector: Buffer,
    ): Promise<void> {
      storeStmt.run({
        id: noteId,
        userId,
        state,
        stateVector,
      });
    },
  };
}
