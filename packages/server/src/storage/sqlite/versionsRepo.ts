import {
  MAX_NOTE_VERSIONS,
  NOTE_VERSION_MAX_AGE_DAYS,
  type SealedNoteVersion,
} from "@manifesto/shared";
import type { VersionsRepo } from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface VersionRow {
  id: string;
  note_id: string;
  key_version: number | string;
  format?: number | string;
  title: string;
  content: string;
  created_at: string;
}

export const VERSION_COLUMNS =
  "id, note_id, key_version, format, title, content, created_at";

export function rowToVersion(row: VersionRow): SealedNoteVersion {
  return {
    id: row.id,
    noteId: row.note_id,
    timestamp: row.created_at,
    keyVersion: Number(row.key_version),
    format: Number(row.format ?? 1),
    title: row.title,
    content: row.content,
  };
}

export function createSqliteVersionsRepo(db: SqliteDB): VersionsRepo {
  const listStmt = db.prepare(
    `SELECT ${VERSION_COLUMNS} FROM note_versions
     WHERE note_id = ? ORDER BY created_at DESC, id DESC`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO note_versions
       (id, note_id, author_id, key_version, format, title, content,
        created_at)
     VALUES (@id, @noteId, @authorId, @keyVersion, @format, @title, @content,
       @createdAt)
     ON CONFLICT (id) DO NOTHING`,
  );
  const expireStmt = db.prepare(
    `DELETE FROM note_versions WHERE note_id = ? AND created_at < ?`,
  );
  // All versions after the newest MAX_NOTE_VERSIONS.
  const trimStmt = db.prepare(
    `DELETE FROM note_versions WHERE note_id = @noteId AND id NOT IN (
       SELECT id FROM note_versions WHERE note_id = @noteId
       ORDER BY created_at DESC, id DESC LIMIT @keep)`,
  );

  const add = db.transaction((input: Parameters<VersionsRepo["add"]>[0]) => {
    if (insertStmt.run(input).changes === 0) return false;
    const cutoff = new Date(
      Date.now() - NOTE_VERSION_MAX_AGE_DAYS * DAY_MS,
    ).toISOString();
    expireStmt.run(input.noteId, cutoff);
    trimStmt.run({ noteId: input.noteId, keep: MAX_NOTE_VERSIONS });
    return true;
  });

  return {
    async list(noteId) {
      return (listStmt.all(noteId) as VersionRow[]).map(rowToVersion);
    },
    async add(input) {
      return add(input);
    },
  };
}
