import {
  LEDGER_TABLE_SQL,
  type Migration,
  pendingMigrations,
} from "../migrations.js";
import type { PgPool } from "./database.js";

const INITIAL_SCHEMA = `
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

/** See the SQLite copy: same column, same reason. */
const NOTE_IMAGE_COUNT = `
ALTER TABLE notes ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
UPDATE notes SET image_count = json_array_length(images::json);
`;

/** See the SQLite copy: same columns, same promotion of the oldest account. */
const USER_ADMIN = `
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET is_admin = TRUE
  WHERE id IN (SELECT id FROM users ORDER BY created_at, id LIMIT 1);
`;

/** See the SQLite copy. Postgres has no `COLLATE NOCASE`, so the index is on
 * the lowered address, like `users_username_lower`. */
const USER_EMAIL = `
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_email_lower ON users (LOWER(email));
`;

/** See the SQLite copy: same table, same reasons. */
const NOTE_SHARES = `
CREATE TABLE note_shares (
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'default',
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  trashed     BOOLEAN NOT NULL DEFAULT FALSE,
  trashed_at  TEXT,
  position    DOUBLE PRECISION NOT NULL DEFAULT 0,
  tags        TEXT NOT NULL DEFAULT '[]',
  reminder    TEXT,
  created_at  TEXT NOT NULL,
  accepted_at TEXT,
  PRIMARY KEY (note_id, user_id)
);
CREATE INDEX note_shares_user ON note_shares(user_id);
CREATE INDEX note_shares_trashed_expiry ON note_shares(trashed, trashed_at);
`;

/** See the SQLite copy. `COLLATE "C"` gives the byte order a prefix range
 * scan needs, which a linguistic collation does not. */
const NOTE_SEARCH_TERMS = `
CREATE TABLE note_terms (
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  term        TEXT COLLATE "C" NOT NULL,
  occurrences INTEGER NOT NULL,
  PRIMARY KEY (note_id, term)
);
CREATE INDEX note_terms_term ON note_terms(term, note_id);
ALTER TABLE notes ADD COLUMN search_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX notes_search_version ON notes(search_version);
`;

export const MIGRATIONS: readonly Migration[] = [
  { id: "0001-initial-schema", sql: INITIAL_SCHEMA },
  { id: "0002-note-image-count", sql: NOTE_IMAGE_COUNT },
  { id: "0003-user-admin", sql: USER_ADMIN },
  { id: "0004-user-email", sql: USER_EMAIL },
  { id: "0005-note-shares", sql: NOTE_SHARES },
  { id: "0006-note-search-terms", sql: NOTE_SEARCH_TERMS },
];

export async function runMigrations(
  pool: PgPool,
  declared: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const client = await pool.connect();
  try {
    // Probed rather than re-issued on every boot: `CREATE TABLE IF NOT EXISTS`
    // against a table that is already there is a statement whose only possible
    // effect is nothing. The create keeps its `IF NOT EXISTS` anyway, so two
    // instances booting at once still cannot collide.
    const ledger = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`,
    );
    if (ledger.rows.length === 0) await client.query(LEDGER_TABLE_SQL);
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM schema_migrations`,
    );
    const pending = pendingMigrations(
      declared,
      rows.map((row) => row.id),
    );
    // One transaction per step, so a partial failure can't leave the schema in
    // an inconsistent state (most importantly, missing the unique
    // LOWER(username) index, which would let duplicate usernames slip past
    // `findByUsername`) and can't record a step that did not finish.
    for (const migration of pending) {
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)`,
          [migration.id, new Date().toISOString()],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
