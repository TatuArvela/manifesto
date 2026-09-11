import type Database from "better-sqlite3";
import {
  LEDGER_TABLE_SQL,
  type Migration,
  pendingMigrations,
} from "../migrations.js";

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  display_name  TEXT NOT NULL DEFAULT '',
  avatar_color  TEXT NOT NULL DEFAULT '',
  provider      TEXT NOT NULL DEFAULT 'local',
  external_id   TEXT,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_external
  ON users(provider, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS notes (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT '',
  content          TEXT NOT NULL DEFAULT '',
  color            TEXT NOT NULL,
  font             TEXT NOT NULL,
  pinned           INTEGER NOT NULL DEFAULT 0,
  archived         INTEGER NOT NULL DEFAULT 0,
  trashed          INTEGER NOT NULL DEFAULT 0,
  trashed_at       TEXT,
  position         REAL NOT NULL DEFAULT 0,
  tags             TEXT NOT NULL DEFAULT '[]',
  images           TEXT NOT NULL DEFAULT '[]',
  link_previews    TEXT NOT NULL DEFAULT '[]',
  reminder         TEXT,
  readonly         INTEGER NOT NULL DEFAULT 0,
  source           TEXT,
  yjs_state        BLOB,
  yjs_state_vector BLOB,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_user_filters
  ON notes(user_id, archived, trashed, pinned);
CREATE INDEX IF NOT EXISTS notes_user_updated
  ON notes(user_id, updated_at);
CREATE INDEX IF NOT EXISTS notes_trashed_expiry
  ON notes(trashed, trashed_at);
`;

/**
 * How many images a note has, kept alongside them so a list query can answer
 * "does this note have attachments" without reading the attachments — which is
 * the whole point of leaving them out of a list response.
 */
const NOTE_IMAGE_COUNT = `
ALTER TABLE notes ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
UPDATE notes SET image_count = json_array_length(images);
`;

export const MIGRATIONS: readonly Migration[] = [
  { id: "0001-initial-schema", sql: INITIAL_SCHEMA },
  { id: "0002-note-image-count", sql: NOTE_IMAGE_COUNT },
];

export function runMigrations(
  db: Database.Database,
  declared: readonly Migration[] = MIGRATIONS,
): void {
  db.exec(LEDGER_TABLE_SQL);
  const applied = (
    db.prepare(`SELECT id FROM schema_migrations`).all() as { id: string }[]
  ).map((row) => row.id);
  const record = db.prepare(
    `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
  );
  // SQLite has transactional DDL, so a step that fails part-way leaves neither
  // half of its schema change nor its ledger row behind.
  const apply = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    record.run(migration.id, new Date().toISOString());
  });
  for (const migration of pendingMigrations(declared, applied)) {
    apply(migration);
  }
}
