import type { PgPool } from "./database.js";

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT,
  display_name  TEXT NOT NULL DEFAULT '',
  avatar_color  TEXT NOT NULL DEFAULT '',
  provider      TEXT NOT NULL DEFAULT 'local',
  external_id   TEXT,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower
  ON users (LOWER(username));
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
  pinned           BOOLEAN NOT NULL DEFAULT FALSE,
  archived         BOOLEAN NOT NULL DEFAULT FALSE,
  trashed          BOOLEAN NOT NULL DEFAULT FALSE,
  trashed_at       TEXT,
  position         DOUBLE PRECISION NOT NULL DEFAULT 0,
  tags             TEXT NOT NULL DEFAULT '[]',
  images           TEXT NOT NULL DEFAULT '[]',
  link_previews    TEXT NOT NULL DEFAULT '[]',
  reminder         TEXT,
  readonly         BOOLEAN NOT NULL DEFAULT FALSE,
  source           TEXT,
  yjs_state        BYTEA,
  yjs_state_vector BYTEA,
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

export async function runMigrations(pool: PgPool): Promise<void> {
  // Run inside a transaction so a partial failure can't leave the schema in an
  // inconsistent state — most importantly, missing the unique LOWER(username)
  // index, which would let duplicate usernames slip past `findByUsername`.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(INIT_SQL);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
