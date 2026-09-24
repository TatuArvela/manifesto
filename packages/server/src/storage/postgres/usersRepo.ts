import type pg from "pg";
import { searchPattern } from "../noteMapping.js";
import {
  type AdminGuardedResult,
  type CreateUserInput,
  EmailTakenError,
  type SetEmailResult,
  type User,
  UsernameTakenError,
  type UserSearchOptions,
  type UserSummary,
  type UsersRepo,
} from "../types.js";
import type { PgPool } from "./database.js";

interface UserRow {
  id: string;
  username: string;
  password_hash: string | null;
  display_name: string;
  avatar_color: string;
  email: string | null;
  provider: string;
  external_id: string | null;
  is_admin: boolean;
  must_change_password: boolean;
  locale: string | null;
  created_at: string;
}

interface UserSummaryRow extends UserRow {
  // `COUNT(*)` is a bigint, which `pg` hands back as a string.
  note_count: string | number;
  last_seen_at: string | null;
}

interface PgError {
  code?: string;
}

/** Postgres signals unique-constraint violations with SQLSTATE 23505. */
function isPgUniqueViolation(err: unknown): boolean {
  return err instanceof Error && (err as PgError).code === "23505";
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    email: row.email,
    provider: row.provider,
    externalId: row.external_id,
    passwordHash: row.password_hash,
    isAdmin: row.is_admin,
    mustChangePassword: row.must_change_password,
    locale: row.locale,
    createdAt: row.created_at,
  };
}

function rowToSummary(row: UserSummaryRow): UserSummary {
  return {
    ...rowToUser(row),
    noteCount: Number(row.note_count),
    lastSeenAt: row.last_seen_at,
  };
}

/** Derived tables, not per-row subqueries: pg-mem cannot resolve an outer
 * column from inside a subquery in the select list. */
const SUMMARY_SELECT = `
  SELECT u.*, COALESCE(n.note_count, 0) AS note_count, s.last_seen_at
  FROM users u
  LEFT JOIN (
    SELECT user_id, COUNT(*) AS note_count FROM notes GROUP BY user_id
  ) n ON n.user_id = u.id
  LEFT JOIN (
    SELECT user_id, MAX(last_seen_at) AS last_seen_at
    FROM sessions GROUP BY user_id
  ) s ON s.user_id = u.id`;

/**
 * Run a change that must not take away the last admin.
 *
 * Every admin row is locked before anything is counted, in id order so two of
 * these cannot deadlock. A second transaction trying the same thing waits for
 * the first to commit, and when it resumes its locking read sees the committed
 * rows. Without the lock, two admins demoting each other at the same moment
 * would each count two admins and both succeed, leaving none.
 */
async function guardedAdminChange(
  pool: PgPool,
  id: string,
  apply: (client: pg.PoolClient, target: UserRow) => Promise<void>,
  removesAdmin: (target: UserRow) => boolean,
): Promise<AdminGuardedResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admins = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE is_admin = TRUE ORDER BY id FOR UPDATE`,
    );
    const found = await client.query<UserRow>(
      `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const target = found.rows[0];
    let result: AdminGuardedResult;
    if (!target) {
      result = "not-found";
    } else if (removesAdmin(target) && admins.rows.length <= 1) {
      result = "last-admin";
    } else {
      await apply(client, target);
      result = "ok";
    }
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function createPostgresUsersRepo(pool: PgPool): UsersRepo {
  const repo: UsersRepo = {
    async create(input: CreateUserInput): Promise<User> {
      try {
        // Under READ COMMITTED two first sign-ins racing each other can both
        // see an empty table, so both become admin. That is the harmless way
        // for this to go wrong; the reverse, nobody, is what the guards on
        // demotion and deletion exist to prevent.
        await pool.query(
          `INSERT INTO users (
            id, username, password_hash, display_name, avatar_color, email,
            provider, external_id, is_admin, must_change_password, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            ($9 OR NOT EXISTS (SELECT 1 FROM users)), $10, $11
          )`,
          [
            input.id,
            input.username,
            input.passwordHash,
            input.displayName,
            input.avatarColor,
            input.email ?? null,
            input.provider,
            input.externalId,
            input.isAdmin ?? false,
            input.mustChangePassword ?? false,
            input.createdAt,
          ],
        );
      } catch (err) {
        if (!isPgUniqueViolation(err)) throw err;
        // Which value collided is read back rather than out of the error. Real
        // `pg` names the index in `constraint`, but pg-mem leaves that empty,
        // names the wrong index, and quotes the whole statement (column list
        // included) in the message, so a message that mentions "username"
        // says nothing about which one was taken.
        if (await repo.findByUsername(input.username)) {
          throw new UsernameTakenError(input.username);
        }
        if (input.email && (await repo.findByEmail(input.email))) {
          throw new EmailTakenError(input.email);
        }
        throw err;
      }
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE id = $1`,
        [input.id],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`Failed to retrieve inserted user ${input.id}`);
      return rowToUser(row);
    },

    async findById(id: string): Promise<User | null> {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    },

    async findByUsername(username: string): Promise<User | null> {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE LOWER(username) = LOWER($1)`,
        [username],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    },

    async findByExternalId(
      provider: string,
      externalId: string,
    ): Promise<User | null> {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE provider = $1 AND external_id = $2`,
        [provider, externalId],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    },

    async findByEmail(email: string): Promise<User | null> {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`,
        [email],
      );
      const row = result.rows[0];
      return row ? rowToUser(row) : null;
    },

    async search(
      query: string,
      { excludeId, limit }: UserSearchOptions,
    ): Promise<User[]> {
      const like = searchPattern(query);
      if (like === null) return [];
      const result = await pool.query<UserRow>(
        `SELECT * FROM users
         WHERE id <> $1
           AND (LOWER(username) LIKE LOWER($2)
             OR LOWER(display_name) LIKE LOWER($2)
             OR LOWER(COALESCE(email, '')) LIKE LOWER($2))
         ORDER BY LOWER(username), id LIMIT $3`,
        [excludeId, like, limit],
      );
      return result.rows.map(rowToUser);
    },

    async setEmail(id: string, email: string | null): Promise<SetEmailResult> {
      try {
        const result = await pool.query(
          `UPDATE users SET email = $1 WHERE id = $2`,
          [email, id],
        );
        return (result.rowCount ?? 0) > 0 ? "ok" : "not-found";
      } catch (err) {
        // The only unique value this writes.
        if (isPgUniqueViolation(err)) return "email-taken";
        throw err;
      }
    },

    async setLocale(id: string, locale: string): Promise<boolean> {
      const result = await pool.query(
        `UPDATE users SET locale = $1 WHERE id = $2`,
        [locale, id],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async list(): Promise<UserSummary[]> {
      const result = await pool.query<UserSummaryRow>(
        `${SUMMARY_SELECT} ORDER BY LOWER(u.username), u.id`,
      );
      return result.rows.map(rowToSummary);
    },

    async listAdmins(): Promise<User[]> {
      const result = await pool.query<UserRow>(
        `SELECT * FROM users WHERE is_admin = TRUE ORDER BY created_at, id`,
      );
      return result.rows.map(rowToUser);
    },

    async summarize(id: string): Promise<UserSummary | null> {
      const result = await pool.query<UserSummaryRow>(
        `${SUMMARY_SELECT} WHERE u.id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? rowToSummary(row) : null;
    },

    async setAdmin(id: string, isAdmin: boolean): Promise<AdminGuardedResult> {
      return guardedAdminChange(
        pool,
        id,
        async (client) => {
          await client.query(`UPDATE users SET is_admin = $1 WHERE id = $2`, [
            isAdmin,
            id,
          ]);
        },
        (target) => target.is_admin && !isAdmin,
      );
    },

    async setPassword(
      id: string,
      passwordHash: string,
      mustChangePassword: boolean,
    ): Promise<boolean> {
      const result = await pool.query(
        `UPDATE users SET password_hash = $1, must_change_password = $2
         WHERE id = $3`,
        [passwordHash, mustChangePassword, id],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async delete(id: string): Promise<AdminGuardedResult> {
      return guardedAdminChange(
        pool,
        id,
        async (client) => {
          await client.query(`DELETE FROM users WHERE id = $1`, [id]);
        },
        (target) => target.is_admin,
      );
    },
  };
  return repo;
}
