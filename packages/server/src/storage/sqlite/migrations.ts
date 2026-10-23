import type Database from "better-sqlite3";
import {
  BEFORE_ENCRYPTION,
  LEDGER_TABLE_SQL,
  type Migration,
  MigrationRefusedError,
  pendingMigrations,
} from "#/storage/migrations.ts";

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
 * The number of images of a note, kept next to them. Thus, a list query can
 * answer "does this note have attachments" without a read of the attachments.
 * That is the reason to leave them out of a list response.
 */
const NOTE_IMAGE_COUNT = `
ALTER TABLE notes ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
UPDATE notes SET image_count = json_array_length(images);
`;

/**
 * Admins, and passwords from an admin that their owner must replace.
 *
 * A new server gets its admin at start (local sign-in) or at its first sign-in
 * (single sign-on). A server that already has accounts had neither. Thus, the
 * oldest account becomes the admin, and after this upgrade, each deployment has
 * an admin.
 */
const USER_ADMIN = `
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_admin = 1
  WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1);
`;

/**
 * An email address, so that a person can be found by it for a share. It is
 * optional, and unique, whatever the case. An address names one person, and a
 * search for a share recipient by it must lead to exactly one account.
 */
const USER_EMAIL = `
ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX users_email ON users(email);
`;

/**
 * Notes shared with other accounts.
 *
 * A row is an invitation until `accepted_at` is set. The note itself (title,
 * body, font, attachments, previews) stays in `notes`, and is the same for all
 * persons. The columns here are what each recipient keeps for themselves, as
 * the owner keeps their values in the own row of the note.
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
 * Images kept outside the note row. See `AttachmentsRepo`. The sweep sets
 * `unreferenced_since` when no note refers to one. It deletes it when that has
 * been true for sufficiently long.
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
 * The version history in connected mode: the earlier title and content of a
 * note, kept by the server. Thus, all devices see the same history. When
 * versions are added, they are pruned for each note to the newest 50 and the
 * last 90 days.
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
 * Personal API tokens: long-lived bearer tokens that a user makes for scripts,
 * kept as a SHA-256 hash, as sessions are. `prefix` is the start of the secret,
 * kept so that a person can tell tokens apart in a list.
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
 * Webhooks: where the server sends the note events of a user. `secret` is kept
 * as it is, because it signs each delivery. `failure_count` counts failures in
 * sequence. Too many of them set `active` to 0.
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
 * Two-factor sign-in (TOTP) for local accounts. A row with `enabled_at` null is
 * a setup that the user did not confirm yet. `last_step` is the time step of
 * the last accepted code. Thus, no code works two times. Recovery codes are
 * hashed.
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
 * Password reset links sent by mail: the SHA-256 of the token, the account that
 * it resets, its expiry, and when it was used. Each can be used one time.
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

/**
 * The audit log: who did what to which account or note, from where. Kept for
 * `AUDIT_RETENTION_DAYS`. The actor and the target are not foreign keys. Thus,
 * an entry about a deleted account stays after it.
 */
const AUDIT_LOG = `
CREATE TABLE audit_log (
  id        TEXT PRIMARY KEY,
  at        TEXT NOT NULL,
  action    TEXT NOT NULL,
  actor_id  TEXT,
  target_id TEXT,
  note_id   TEXT,
  ip        TEXT,
  detail    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at ON audit_log(at);
CREATE INDEX audit_log_actor ON audit_log(actor_id);
CREATE INDEX audit_log_target ON audit_log(target_id);
`;

/**
 * Images are references to the attachment store now, never inline. No release
 * contained inline images. Thus, the code drops those of a development
 * database, and does not move them.
 */
const DROP_INLINE_IMAGES = `
UPDATE notes SET images = '[]', image_count = 0 WHERE images LIKE '%"data:%';
`;

/**
 * The thumbnails and favicons of link previews are also attachment references
 * now. SQL cannot move an inline one into the attachment store in both
 * dialects. Thus, as for images, a note that still has one loses its preview
 * cards. The links themselves stay in the text of the note.
 */
const DROP_INLINE_PREVIEW_IMAGES = `
UPDATE notes SET link_previews = '[]' WHERE link_previews LIKE '%"data:%';
`;

/**
 * The language of the client of an account, which the client reports. Thus,
 * mail that the action of a different person sends to them (a share invitation)
 * is in their language, not in the language of the sender. Null until a client
 * reports it.
 */
const USER_LOCALE = `
ALTER TABLE users ADD COLUMN locale TEXT;
`;

/**
 * The preferences of each account, as one JSON object into which its clients
 * merge. Thus, hidden tags and the other preferences go with the account, and
 * do not stay on one device. It is a separate table, not a column on `users`,
 * which each authenticated request reads.
 */
const USER_PREFS = `
CREATE TABLE user_prefs (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/**
 * The purpose of a personal token: `api` for scripts, `mcp` for an AI
 * assistant, which only `/api/v1/mcp` accepts. `read_only` limits an MCP token
 * to the tools that read. Each token made before this is for a script.
 */
const API_TOKEN_KIND = `
ALTER TABLE api_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'api';
ALTER TABLE api_tokens ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;
`;

/**
 * What each token can reach, as a JSON array of `ApiTokenScope`. A token made
 * before this gets only reading and writing of notes. It cannot reach the
 * sharing and account routes that it could reach until now. A read-only MCP
 * token only reads notes. `read_only` stays, but the code does not read it now.
 */
const API_TOKEN_SCOPES = `
ALTER TABLE api_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT '["notes:read","notes:write"]';
UPDATE api_tokens SET scopes = '["notes:read"]' WHERE read_only = 1;
`;

/**
 * When the members of a note last changed: a person invited, accepted, got a
 * different role, or was removed. That changes `sharing` for all persons on the
 * note, but does not change `updated_at`. That is the concurrency token of the
 * note, and must not move for it. Thus, `GET /api/v1/sync` reads this next to
 * it. Null until the first change after this migration.
 */
const NOTE_MEMBERS_CHANGED = `
ALTER TABLE notes ADD COLUMN members_changed_at TEXT;
`;

/**
 * Public links to a note that the owner can revoke. All persons with the token
 * can read them. A `snapshot` link keeps its own copy of the note (JSON of
 * `PublicNote`). A `live` link reads the note each time. The token is kept as
 * it is, because the owner copies the link again from here, and a person who
 * can read this table can read the notes themselves anyway. The links go with
 * their note.
 */
const PUBLIC_LINKS = `
CREATE TABLE public_links (
  token          TEXT PRIMARY KEY,
  note_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode           TEXT NOT NULL,
  snapshot       TEXT,
  password_hash  TEXT,
  expires_at     TEXT,
  max_views      INTEGER,
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX public_links_note ON public_links(note_id);
`;

/**
 * Teams, as share targets. An admin fills a `local` team. An `oidc` team
 * mirrors a group at the identity provider, with the name that the provider
 * gives it. Thus, the name is unique within its source, not across both. A
 * share of a note with a team is a `note_team_shares` row, and one
 * `note_shares` row for each member, marked in `via_team` with the team through
 * which it came. A direct share leaves it null. Each access check continues to
 * read only `note_shares`.
 */
const TEAMS = `
CREATE TABLE teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source, name)
);
CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members(user_id);
CREATE TABLE note_team_shares (
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, team_id)
);
CREATE INDEX note_team_shares_team ON note_team_shares(team_id);
ALTER TABLE note_shares ADD COLUMN via_team TEXT;
`;

/**
 * Assistants that sign in to `/api/v1/mcp` by OAuth. A grant is an `mcp` row of
 * `api_tokens`. Thus, it is listed, revoked and ended with the sessions of the
 * user, as all tokens are.
 *
 * - `token_hash` is its current access token, which expires at
 *   `access_expires_at`.
 * - `refresh_hash` is the refresh token that replaces both. The previous one is
 *   kept in `previous_refresh_hash`, because a refresh token that comes back
 *   after its replacement was copied, and ends the grant.
 * - `oauth_clients` are the clients that registered themselves here (a client
 *   identified by the address of its metadata document is not stored).
 * - `oauth_codes` are the codes that a consent gives, each good one time, for
 *   one minute.
 * - `redirect_uris` and `scopes` are JSON arrays.
 */
const OAUTH = `
ALTER TABLE api_tokens ADD COLUMN oauth_client_id TEXT;
ALTER TABLE api_tokens ADD COLUMN refresh_hash TEXT;
ALTER TABLE api_tokens ADD COLUMN previous_refresh_hash TEXT;
ALTER TABLE api_tokens ADD COLUMN access_expires_at TEXT;
CREATE UNIQUE INDEX api_tokens_refresh ON api_tokens(refresh_hash);
CREATE INDEX api_tokens_previous_refresh ON api_tokens(previous_refresh_hash);
CREATE TABLE oauth_clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE TABLE oauth_codes (
  code_hash        TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  client_name      TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri     TEXT NOT NULL,
  code_challenge   TEXT NOT NULL,
  scopes           TEXT NOT NULL,
  grant_expires_at TEXT,
  expires_at       TEXT NOT NULL
);
`;

/**
 * Passkeys (WebAuthn credentials): a second factor next to the authenticator
 * app, and a way to sign in alone. `credential_id` and `public_key` (a COSE
 * key) are base64url. `transports` is a JSON array. `rp_id` is the host for
 * which the passkey was made, because a passkey works only on its own address.
 * `counter` is the signature count of the authenticator, which only increases.
 */
const PASSKEYS = `
CREATE TABLE passkeys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       INTEGER NOT NULL,
  transports    TEXT NOT NULL,
  rp_id         TEXT NOT NULL,
  name          TEXT NOT NULL,
  synced        INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX passkeys_user ON passkeys(user_id);
`;

/**
 * Sign-in links sent by mail, with the shape of `password_resets`: the SHA-256
 * of the token, the account that it signs in, its expiry, and when it was used.
 */
const SIGN_IN_LINKS = `
CREATE TABLE sign_in_links (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX sign_in_links_user ON sign_in_links(user_id, created_at);
`;

/**
 * Comments next to a note. They go with the note, and stay when their author
 * loses the note or their account. `author_id` is then not a participant, or
 * null, and the comment shows without a name.
 */
const NOTE_COMMENTS = `
CREATE TABLE note_comments (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at  TEXT
);
CREATE INDEX note_comments_note ON note_comments(note_id, created_at);
`;

/**
 * Web Push: the subscriptions that browsers give, one row for each browser
 * profile (an endpoint is unique to one), gone with the session in which it was
 * made. Also `server_secrets`: what the server makes for itself one time and
 * must keep, by name: the key with which it signs push messages.
 */
const WEB_PUSH = `
CREATE TABLE push_subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE server_secrets (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/**
 * The keys with which an account unlocks its notes. None of them opens anything
 * here: the account key wrapped under the secret key and under the recovery
 * key, a hash of the value with which the recovery key proves itself, and the
 * two key pairs of the account with the private halves wrapped. The recovery
 * key replaces the two-factor recovery codes. Thus, their table goes.
 */
const ACCOUNT_KEYS = `
CREATE TABLE account_keys (
  user_id                      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version                      INTEGER NOT NULL,
  wrapped_by_secret            TEXT NOT NULL,
  wrapped_by_recovery          TEXT NOT NULL,
  recovery_verifier_hash       TEXT NOT NULL,
  exchange_public_key          TEXT NOT NULL,
  signing_public_key           TEXT NOT NULL,
  wrapped_exchange_private_key TEXT NOT NULL,
  wrapped_signing_private_key  TEXT NOT NULL,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL
);
DROP TABLE totp_recovery_codes;
`;

/**
 * Notes sealed in the browser. The columns that contained the words of a note
 * now contain ciphertext. Next to them are the note key wrapped for its owner
 * (and, in `note_shares`, for each recipient), the version of that key, the
 * excerpt, and the sealed list of images. `images` keeps the attachment
 * references that the list names, and `preview_refs` those of the link
 * previews, because the server cannot read either list now, and must still keep
 * the attachments. Preferences written before were readable. Thus, they go.
 */
const SEALED_NOTES = `
ALTER TABLE notes ADD COLUMN excerpt TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN image_list TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN preview_refs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE notes ADD COLUMN wrapped_key TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE note_shares ADD COLUMN wrapped_key TEXT NOT NULL DEFAULT '';
ALTER TABLE note_versions ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;
DELETE FROM user_prefs;
`;

/**
 * A note key on its way to a person who shares the note: wrapped to their
 * public key and signed (`offered_key`, as JSON), until their client keeps it
 * under their own notes key (`wrapped_key`, at `wrapped_key_version`).
 */
const SHARE_KEYS = `
ALTER TABLE note_shares ADD COLUMN offered_key TEXT;
ALTER TABLE note_shares ADD COLUMN wrapped_key_version INTEGER NOT NULL DEFAULT 0;
`;

/**
 * The text of a comment is sealed under the key of its note. This tells which
 * key.
 */
const COMMENT_KEYS = `
ALTER TABLE note_comments ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;
`;

/**
 * The keys of a token, wrapped under a key derived from its secret. Thus, the
 * server can open them only while a request has the token.
 */
const TOKEN_KEYS = `
ALTER TABLE api_tokens ADD COLUMN wrapped_keys TEXT;
`;

/**
 * The keys of a public link, neither of which the server can use: the note key
 * wrapped by the link key (a live link), and the link key sealed for its owner,
 * to copy the address again.
 */
const LINK_KEYS = `
ALTER TABLE public_links ADD COLUMN wrapped_key TEXT;
ALTER TABLE public_links ADD COLUMN sealed_link_key TEXT NOT NULL DEFAULT '';
`;

/**
 * The replacement of the key of a note: its previous keys, sealed under its
 * current key, and if the app of its owner must replace it, because a person
 * who had it does not have the note now.
 */
const NOTE_REKEY = `
ALTER TABLE notes ADD COLUMN previous_keys TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN rekey_due INTEGER NOT NULL DEFAULT 0;
`;

/**
 * The public keys that an account saw of the people with whom it shares, each
 * sealed under the own key of that account. The server keeps the list, and
 * reads none of it.
 */
const SEEN_KEYS = `
CREATE TABLE seen_keys (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id    TEXT NOT NULL,
  sealed     TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, peer_id)
);
`;

/**
 * The key of a note as a calendar feed opens it: wrapped under the reminder key
 * of its reader while the note has a reminder. The copy of the owner is on the
 * note, and that of a recipient is on their share, as the reminder itself.
 */
const REMINDER_KEYS = `
ALTER TABLE notes ADD COLUMN reminder_key TEXT NOT NULL DEFAULT '';
ALTER TABLE note_shares ADD COLUMN reminder_key TEXT NOT NULL DEFAULT '';
`;

/**
 * The keys that the sign-in of an assistant carries from the consent page to
 * its tokens: wrapped under the code until it is traded in, and then under the
 * refresh token, next to the copy under the access token.
 */
const OAUTH_KEYS = `
ALTER TABLE oauth_codes ADD COLUMN wrapped_keys TEXT;
ALTER TABLE api_tokens ADD COLUMN refresh_wrapped_keys TEXT;
`;

/**
 * The key of an image that a token uploaded, wrapped under the notes key of its
 * uploader until a note names the image. The server keeps nothing between the
 * upload and the next note. Thus, it is kept here, unreadable.
 */
const ATTACHMENT_KEYS = `
ALTER TABLE attachments ADD COLUMN wrapped_key TEXT;
`;

/**
 * The format of the words of a note (`noteFormat.ts` in shared), for the note
 * and for each of its versions. Readable, because a client must know before it
 * opens a note if it can read it, and the server checks each write against it.
 * All notes stored so far are format 1.
 */
const NOTE_FORMAT = `
ALTER TABLE notes ADD COLUMN format INTEGER NOT NULL DEFAULT 1;
ALTER TABLE note_versions ADD COLUMN format INTEGER NOT NULL DEFAULT 1;
`;

/**
 * Requests to sign in a new device, by a QR code that it shows and a signed-in
 * device approves. `user_id` and the wrapped key are null until the approval.
 * The wrapped key is the secret key of the account, which only the new device
 * can open.
 */
const DEVICE_SIGN_INS = `
CREATE TABLE device_sign_ins (
  id_hash       TEXT PRIMARY KEY,
  wait_hash     TEXT NOT NULL UNIQUE,
  user_agent    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  key_ephemeral TEXT,
  key_wrapped   TEXT,
  approved_at   TEXT,
  used_at       TEXT
);
CREATE INDEX device_sign_ins_user ON device_sign_ins(user_id);
CREATE INDEX device_sign_ins_expiry ON device_sign_ins(expires_at);
`;

export const MIGRATIONS: readonly Migration[] = [
  { id: "0001-initial-schema", sql: INITIAL_SCHEMA },
  { id: "0002-note-image-count", sql: NOTE_IMAGE_COUNT },
  { id: "0003-user-admin", sql: USER_ADMIN },
  { id: "0004-user-email", sql: USER_EMAIL },
  { id: "0005-note-shares", sql: NOTE_SHARES },
  { id: "0006-attachments", sql: ATTACHMENTS },
  { id: "0007-note-versions", sql: NOTE_VERSIONS },
  { id: "0008-api-tokens", sql: API_TOKENS },
  { id: "0009-webhooks", sql: WEBHOOKS },
  { id: "0010-two-factor", sql: TWO_FACTOR },
  { id: "0011-password-resets", sql: PASSWORD_RESETS },
  { id: "0012-audit-log", sql: AUDIT_LOG },
  { id: "0013-drop-inline-images", sql: DROP_INLINE_IMAGES },
  { id: "0014-drop-inline-preview-images", sql: DROP_INLINE_PREVIEW_IMAGES },
  { id: "0015-user-locale", sql: USER_LOCALE },
  { id: "0016-user-prefs", sql: USER_PREFS },
  { id: "0017-api-token-kind", sql: API_TOKEN_KIND },
  { id: "0018-api-token-scopes", sql: API_TOKEN_SCOPES },
  { id: "0019-note-members-changed", sql: NOTE_MEMBERS_CHANGED },
  { id: "0020-public-links", sql: PUBLIC_LINKS },
  { id: "0021-teams", sql: TEAMS },
  { id: "0022-oauth", sql: OAUTH },
  { id: "0023-passkeys", sql: PASSKEYS },
  { id: "0024-sign-in-links", sql: SIGN_IN_LINKS },
  { id: "0025-note-comments", sql: NOTE_COMMENTS },
  { id: "0026-web-push", sql: WEB_PUSH },
  // Refused on the first step of encryption. Thus, a database that the server
  // refuses is still the database that the older version left. The second step
  // keeps the refusal for a database that an earlier build stopped between the
  // two steps.
  { id: "0027-account-keys", sql: ACCOUNT_KEYS, refuseIf: BEFORE_ENCRYPTION },
  { id: "0028-sealed-notes", sql: SEALED_NOTES, refuseIf: BEFORE_ENCRYPTION },
  { id: "0029-share-keys", sql: SHARE_KEYS },
  { id: "0030-comment-keys", sql: COMMENT_KEYS },
  { id: "0031-token-keys", sql: TOKEN_KEYS },
  { id: "0032-link-keys", sql: LINK_KEYS },
  { id: "0033-note-rekey", sql: NOTE_REKEY },
  { id: "0034-seen-keys", sql: SEEN_KEYS },
  { id: "0035-reminder-keys", sql: REMINDER_KEYS },
  { id: "0036-oauth-keys", sql: OAUTH_KEYS },
  { id: "0037-attachment-keys", sql: ATTACHMENT_KEYS },
  { id: "0038-note-format", sql: NOTE_FORMAT },
  { id: "0039-device-sign-ins", sql: DEVICE_SIGN_INS },
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
  // SQLite has transactional DDL. Thus, a step that fails partly leaves neither
  // half of its schema change nor its ledger row.
  const apply = db.transaction((migration: Migration) => {
    if (
      migration.refuseIf &&
      db.prepare(migration.refuseIf.sql).get() !== undefined
    ) {
      throw new MigrationRefusedError(migration.refuseIf.message);
    }
    db.exec(migration.sql);
    record.run(migration.id, new Date().toISOString());
  });
  for (const migration of pendingMigrations(declared, applied)) {
    apply(migration);
  }
}
