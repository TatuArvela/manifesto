import {
  MAX_NOTE_VERSIONS,
  NOTE_VERSION_MAX_AGE_DAYS,
  type NoteVersion,
} from "@manifesto/shared";
import type { VersionsRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface VersionRow {
  note_id: string;
  title: string;
  content: string;
  created_at: string;
}

export function rowToVersion(row: VersionRow): NoteVersion {
  return {
    noteId: row.note_id,
    timestamp: row.created_at,
    title: row.title,
    content: row.content,
  };
}

export function createSqliteVersionsRepo(db: SqliteDB): VersionsRepo {
  const listStmt = db.prepare(
    `SELECT note_id, title, content, created_at FROM note_versions
     WHERE note_id = ? ORDER BY created_at DESC, id DESC`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO note_versions (id, note_id, author_id, title, content, created_at)
     VALUES (@id, @noteId, @authorId, @title, @content, @createdAt)`,
  );
  const expireStmt = db.prepare(
    `DELETE FROM note_versions WHERE note_id = ? AND created_at < ?`,
  );
  // Everything past the newest MAX_NOTE_VERSIONS.
  const trimStmt = db.prepare(
    `DELETE FROM note_versions WHERE note_id = @noteId AND id NOT IN (
       SELECT id FROM note_versions WHERE note_id = @noteId
       ORDER BY created_at DESC, id DESC LIMIT @keep)`,
  );

  const add = db.transaction((input: Parameters<VersionsRepo["add"]>[0]) => {
    insertStmt.run(input);
    const cutoff = new Date(
      Date.now() - NOTE_VERSION_MAX_AGE_DAYS * DAY_MS,
    ).toISOString();
    expireStmt.run(input.noteId, cutoff);
    trimStmt.run({ noteId: input.noteId, keep: MAX_NOTE_VERSIONS });
  });

  return {
    async list(noteId) {
      return (listStmt.all(noteId) as VersionRow[]).map(rowToVersion);
    },
    async add(input) {
      add(input);
    },
  };
}
