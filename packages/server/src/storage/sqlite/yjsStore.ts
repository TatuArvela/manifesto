import type { YjsStore } from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

interface YjsStateRow {
  yjs_state: Buffer | null;
}

export function createSqliteYjsStore(db: SqliteDB): YjsStore {
  const fetchStmt = db.prepare(
    `SELECT yjs_state FROM notes
     WHERE id = ? AND user_id = ?`,
  );
  // Does NOT change `updated_at`, on purpose. REST optimistic concurrency
  // tracks that field, and Yjs writes must not make the `If-Match` tokens of
  // REST clients invalid.
  const storeStmt = db.prepare(
    `UPDATE notes
       SET yjs_state = @state,
           yjs_state_vector = @stateVector
     WHERE id = @id AND user_id = @ownerId`,
  );

  return {
    async load(noteId: string, ownerId: string): Promise<Buffer | null> {
      const row = fetchStmt.get(noteId, ownerId) as YjsStateRow | undefined;
      return row?.yjs_state ?? null;
    },

    async store(
      noteId: string,
      ownerId: string,
      state: Buffer,
      stateVector: Buffer,
    ): Promise<void> {
      storeStmt.run({
        id: noteId,
        ownerId,
        state,
        stateVector,
      });
    },
  };
}
