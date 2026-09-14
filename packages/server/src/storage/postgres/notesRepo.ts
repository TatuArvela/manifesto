import type { Note, NoteUpdate } from "@manifesto/shared";
import {
  decodeCursor,
  INSERT_COLUMNS,
  noteInsertValues,
  noteUpdateColumns,
  searchPattern,
  splitPage,
} from "../noteMapping.js";
import {
  attachSharing,
  forbiddenFields,
  type MemberRow,
  mergePages,
  ownerIdsOf,
  parseRole,
  rowToViewNote,
  SHARE_OVERLAY_COLUMNS,
  splitChanges,
  type UserBriefRow,
  type ViewRow,
} from "../shareMapping.js";
import {
  type InsertNoteInput,
  type ListNotesOptions,
  type NoteAccess,
  NoteAccessError,
  type NotePage,
  type NotesRepo,
} from "../types.js";
import type { PgPool } from "./database.js";

/** See the SQLite copy: same columns, same ordering, same reasons. */
const LIST_COLUMNS = INSERT_COLUMNS.filter((c) => c !== "images")
  .map((c) => `n.${c}`)
  .join(", ");

interface OwnerRow {
  user_id: string;
  trashed: boolean;
}

function placeholders(from: number, count: number): string {
  return Array.from({ length: count }, (_, i) => `$${from + i}`).join(", ");
}

export function createPostgresNotesRepo(pool: PgPool): NotesRepo {
  /** See the SQLite copy. */
  async function view(
    rows: ViewRow[],
    viewerId: string,
    listed: boolean,
  ): Promise<Note[]> {
    const notes = rows.map((row) => rowToViewNote(row, listed));
    if (rows.length === 0) return notes;
    const ids = rows.map((row) => row.id);
    const members = await pool.query<MemberRow>(
      `SELECT s.note_id, s.user_id, s.role, s.created_at, s.accepted_at,
              u.username, u.display_name, u.avatar_color
       FROM note_shares s JOIN users u ON u.id = s.user_id
       WHERE s.note_id IN (${placeholders(1, ids.length)})`,
      ids,
    );
    if (members.rows.length === 0) return notes;
    const ownerIds = ownerIdsOf(rows);
    const users = await pool.query<UserBriefRow>(
      `SELECT id, username, display_name, avatar_color FROM users
       WHERE id IN (${placeholders(1, ownerIds.length)})`,
      ownerIds,
    );
    return attachSharing(rows, notes, viewerId, members.rows, users.rows);
  }

  /**
   * One half of a listing: the user's own notes, or those shared with them.
   * Over-fetched by one, as the SQLite copy explains.
   */
  async function half(
    kind: "own" | "shared",
    userId: string,
    like: string | null,
    { limit, cursor }: ListNotesOptions,
  ): Promise<ViewRow[]> {
    const params: unknown[] = [userId];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    let sql =
      kind === "own"
        ? `SELECT ${LIST_COLUMNS} FROM notes n WHERE n.user_id = $1`
        : `SELECT ${LIST_COLUMNS}, ${SHARE_OVERLAY_COLUMNS}
           FROM note_shares s JOIN notes n ON n.id = s.note_id
           WHERE s.user_id = $1 AND s.accepted_at IS NOT NULL
             AND n.trashed = FALSE`;
    if (like !== null) {
      const p = param(like);
      sql += ` AND (LOWER(n.title) LIKE LOWER(${p})
                 OR LOWER(n.content) LIKE LOWER(${p}))`;
    }
    const after = cursor ? decodeCursor(cursor) : null;
    if (after) {
      const at = param(after.updatedAt);
      const id = param(after.id);
      sql += ` AND (n.updated_at < ${at} OR (n.updated_at = ${at} AND n.id < ${id}))`;
    }
    sql += ` ORDER BY n.updated_at DESC, n.id DESC LIMIT ${param(limit + 1)}`;
    return (await pool.query<ViewRow>(sql, params)).rows;
  }

  async function page(
    userId: string,
    like: string | null,
    options: ListNotesOptions,
  ): Promise<NotePage> {
    const [own, shared] = await Promise.all([
      half("own", userId, like, options),
      half("shared", userId, like, options),
    ]);
    const { page: kept, nextCursor } = splitPage(
      mergePages(own, shared, options.limit),
      options.limit,
    );
    return { notes: await view(kept, userId, true), nextCursor };
  }

  async function acceptedRole(
    query: PgPool["query"],
    id: string,
    userId: string,
    lock: boolean,
  ): Promise<string | null> {
    const result = await query<{ role: string }>(
      `SELECT role FROM note_shares
       WHERE note_id = $1 AND user_id = $2 AND accepted_at IS NOT NULL
       ${lock ? "FOR UPDATE" : ""}`,
      [id, userId],
    );
    return result.rows[0]?.role ?? null;
  }

  /** See the SQLite copy. The share row is locked for the length of the
   * write, so a revocation waits for it or it waits for the revocation. */
  async function recipientUpdate(
    id: string,
    userId: string,
    changes: NoteUpdate,
    updatedAt: string,
    expectedUpdatedAt: string | undefined,
  ): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const role = await acceptedRole(
        client.query.bind(client) as PgPool["query"],
        id,
        userId,
        true,
      );
      if (role === null) {
        await client.query("ROLLBACK");
        return false;
      }
      const split = splitChanges(changes);
      const forbidden = forbiddenFields(parseRole(role), split);
      if (forbidden.length > 0) throw new NoteAccessError(forbidden);

      const note = noteUpdateColumns(split.shared, "native");
      const params: unknown[] = [...note.values, updatedAt];
      const assignments = [...note.columns, "updated_at"].map(
        (column, i) => `${column} = $${i + 1}`,
      );
      params.push(id);
      let where = `WHERE id = $${params.length} AND trashed = FALSE`;
      if (expectedUpdatedAt !== undefined) {
        params.push(expectedUpdatedAt);
        where += ` AND updated_at = $${params.length}`;
      }
      const written = await client.query(
        `UPDATE notes SET ${assignments.join(", ")} ${where}`,
        params,
      );
      if ((written.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return false;
      }

      const personal = noteUpdateColumns(split.personal, "native");
      if (personal.columns.length > 0) {
        const count = personal.values.length;
        await client.query(
          `UPDATE note_shares SET ${personal.columns
            .map((column, i) => `${column} = $${i + 1}`)
            .join(", ")}
           WHERE note_id = $${count + 1} AND user_id = $${count + 2}`,
          [...personal.values, id, userId],
        );
      }
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function ownerOf(id: string): Promise<OwnerRow | null> {
    const result = await pool.query<OwnerRow>(
      `SELECT user_id, trashed FROM notes WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  const repo: NotesRepo = {
    async listByUser(
      userId: string,
      options: ListNotesOptions,
    ): Promise<NotePage> {
      return page(userId, null, options);
    },

    async getById(id: string, userId: string): Promise<Note | null> {
      // Two plain reads rather than a join with a compound `ON`, which is the
      // shape of query pg-mem is least reliable about.
      const found = await pool.query<ViewRow>(
        `SELECT * FROM notes WHERE id = $1`,
        [id],
      );
      const note = found.rows[0];
      if (!note) return null;
      if (note.user_id === userId) {
        return (await view([note], userId, false))[0] ?? null;
      }
      if (note.trashed) return null;
      const share = await pool.query<ViewRow>(
        `SELECT ${SHARE_OVERLAY_COLUMNS} FROM note_shares s
         WHERE s.note_id = $1 AND s.user_id = $2 AND s.accepted_at IS NOT NULL`,
        [id, userId],
      );
      const overlay = share.rows[0];
      if (!overlay) return null;
      return (await view([{ ...note, ...overlay }], userId, false))[0] ?? null;
    },

    async access(id: string, userId: string): Promise<NoteAccess | null> {
      const note = await ownerOf(id);
      if (!note) return null;
      if (note.user_id === userId) {
        return { role: "owner", ownerId: note.user_id };
      }
      if (note.trashed) return null;
      const role = await acceptedRole(pool.query.bind(pool), id, userId, false);
      return role === null
        ? null
        : { role: parseRole(role), ownerId: note.user_id };
    },

    async insert(input: InsertNoteInput): Promise<Note> {
      await pool.query(
        `INSERT INTO notes (${INSERT_COLUMNS.join(", ")})
         VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`,
        noteInsertValues(input, "native"),
      );
      const note = await repo.getById(input.id, input.userId);
      if (!note)
        throw new Error(`Failed to retrieve inserted note ${input.id}`);
      return note;
    },

    async update(
      id: string,
      userId: string,
      changes: NoteUpdate,
      updatedAt: string,
      expectedUpdatedAt?: string,
    ): Promise<Note | null> {
      const owner = await ownerOf(id);
      if (!owner) return null;
      if (owner.user_id !== userId) {
        const written = await recipientUpdate(
          id,
          userId,
          changes,
          updatedAt,
          expectedUpdatedAt,
        );
        return written ? await repo.getById(id, userId) : null;
      }
      const { columns, values } = noteUpdateColumns(changes, "native");
      const params = [...values, updatedAt, id, userId];
      const assignments = [...columns, "updated_at"].map(
        (column, i) => `${column} = $${i + 1}`,
      );
      const idParam = params.length - 1;
      // Compare-and-set on `updated_at` when the caller passed `If-Match`;
      // collapses the prior read-then-write race into a single atomic write.
      let where = `WHERE id = $${idParam} AND user_id = $${idParam + 1}`;
      if (expectedUpdatedAt !== undefined) {
        params.push(expectedUpdatedAt);
        where += ` AND updated_at = $${params.length}`;
      }
      const sql = `UPDATE notes SET ${assignments.join(", ")} ${where}`;
      const result = await pool.query(sql, params);
      if ((result.rowCount ?? 0) === 0) return null;
      return await repo.getById(id, userId);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const result = await pool.query(
        `DELETE FROM notes WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async search(
      userId: string,
      query: string,
      options: ListNotesOptions,
    ): Promise<NotePage> {
      const like = searchPattern(query);
      if (like === null) return { notes: [], nextCursor: null };
      return page(userId, like, options);
    },
  };

  return repo;
}
