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
 * "does this note have attachments" without reading the attachments, which is
 * the whole point of leaving them out of a list response.
 */
const NOTE_IMAGE_COUNT = `
ALTER TABLE notes ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
UPDATE notes SET image_count = json_array_length(images);
`;

/**
 * Admins, and passwords an admin issued that their owner has to replace.
 *
 * A new server gets its admin on boot (local sign-in) or at its first sign-in
 * (single sign-on). A server that already has accounts has had neither, so the
 * oldest one is promoted and no deployment comes out of this upgrade with
 * nobody able to administer it.
 */
const USER_ADMIN = `
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_admin = 1
  WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1);
`;

/**
 * An email address, so a person can be found by it when a note is shared.
 * Optional, and unique regardless of case: an address names one person, and
 * finding a share recipient by it has to lead to exactly one account.
 */
const USER_EMAIL = `
ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX users_email ON users(email);
`;

/**
 * Notes shared with other accounts.
 *
 * A row is an invitation until `accepted_at` is set. The note itself (title,
 * body, font, attachments, previews) stays in `notes` and is the same for
 * everyone; the columns here are what each recipient keeps for themselves, the
 * way the owner keeps theirs in the note's own row.
 */
const NOTE_SHARES = `
CREATE TABLE note_shares (
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'default',
  pinned      INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  trashed     INTEGER NOT NULL DEFAULT 0,
  trashed_at  TEXT,
  position    REAL NOT NULL DEFAULT 0,
  tags        TEXT NOT NULL DEFAULT '[]',
  reminder    TEXT,
  created_at  TEXT NOT NULL,
  accepted_at TEXT,
  PRIMARY KEY (note_id, user_id)
);
CREATE INDEX note_shares_user ON note_shares(user_id);
CREATE INDEX note_shares_trashed_expiry ON note_shares(trashed, trashed_at);
`;

/**
 * The search index: each note's distinct words (see `storage/searchTerms.ts`)
 * and, on the note, the tokenizer version it was indexed with. A note at 0,
 * which every existing note starts as, is indexed at the next startup.
 */
const NOTE_SEARCH_TERMS = `
CREATE TABLE note_terms (
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  term        TEXT NOT NULL,
  occurrences INTEGER NOT NULL,
  PRIMARY KEY (note_id, term)
);
CREATE INDEX note_terms_term ON note_terms(term, note_id);
ALTER TABLE notes ADD COLUMN search_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX notes_search_version ON notes(search_version);
`;

/**
 * Images kept outside the note row; see `AttachmentsRepo`. `unreferenced_since`
 * is set by the sweep when no note refers to one, which deletes it once that
 * has been true for long enough.
 */
const ATTACHMENTS = `
CREATE TABLE attachments (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sha256             TEXT NOT NULL,
  content_type       TEXT NOT NULL,
  size               INTEGER NOT NULL,
  data               BLOB NOT NULL,
  created_at         TEXT NOT NULL,
  unreferenced_since TEXT,
  UNIQUE (owner_id, sha256)
);
`;

/**
 * Version history in connected mode: a note's earlier title and content,
 * kept by the server so every device sees the same history. Pruned per note to
 * the newest 50 and the last 90 days as versions are added.
 */
const NOTE_VERSIONS = `
CREATE TABLE note_versions (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX note_versions_note ON note_versions(note_id, created_at);
`;

/**
 * Personal API tokens: long-lived bearer tokens a user mints for scripts, held
 * as a SHA-256 hash like sessions. `prefix` is the start of the secret, kept
 * so a list of tokens can be told apart.
 */
const API_TOKENS = `
CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  expires_at   TEXT
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);
`;

/**
 * Webhooks: where a user's note events are posted. `secret` is kept as is,
 * since it signs every delivery. `failure_count` counts failures in a row;
 * enough of them sets `active` to 0.
 */
const WEBHOOKS = `
CREATE TABLE webhooks (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  secret           TEXT NOT NULL,
  events           TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  last_delivery_at TEXT,
  last_status      INTEGER,
  last_error       TEXT,
  failure_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX webhooks_user ON webhooks(user_id);
`;

/**
 * Two-factor sign-in (TOTP) for local accounts. A row with `enabled_at` null
 * is a setup the user has not confirmed yet. `last_step` is the time step of
 * the last code accepted, so no code works twice. Recovery codes are hashed.
 */
const TWO_FACTOR = `
CREATE TABLE user_totp (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret     TEXT NOT NULL,
  enabled_at TEXT,
  last_step  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE totp_recovery_codes (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at   TEXT,
  PRIMARY KEY (user_id, code_hash)
);
`;

/**
 * Password reset links sent by mail: the SHA-256 of the token, whose account
 * it resets, until when, and when it was used. One use each.
 */
const PASSWORD_RESETS = `
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX password_resets_user ON password_resets(user_id, created_at);
`;

export const MIGRATIONS: readonly Migration[] = [
  { id: "0001-initial-schema", sql: INITIAL_SCHEMA },
  { id: "0002-note-image-count", sql: NOTE_IMAGE_COUNT },
  { id: "0003-user-admin", sql: USER_ADMIN },
  { id: "0004-user-email", sql: USER_EMAIL },
  { id: "0005-note-shares", sql: NOTE_SHARES },
  { id: "0006-note-search-terms", sql: NOTE_SEARCH_TERMS },
  { id: "0007-attachments", sql: ATTACHMENTS },
  { id: "0008-note-versions", sql: NOTE_VERSIONS },
  { id: "0009-api-tokens", sql: API_TOKENS },
  { id: "0010-webhooks", sql: WEBHOOKS },
  { id: "0011-two-factor", sql: TWO_FACTOR },
  { id: "0012-password-resets", sql: PASSWORD_RESETS },
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
