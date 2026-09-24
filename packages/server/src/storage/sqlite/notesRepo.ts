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
import type { SqliteDB } from "./database.js";

/**
 * Everything but the attachments. Listing queries select this so the bytes
 * never leave the database, which is the point of leaving them out of the
 * response.
 */
const LIST_COLUMNS = INSERT_COLUMNS.filter((c) => c !== "images");

/**
 * Ordered by `updated_at DESC, id DESC`, so a cursor is a place in a total
 * order rather than a timestamp two notes might share. Written as two
 * comparisons rather than a row value because pg-mem, which the parallel
 * Postgres suite runs on, does not parse `(a, b) < (c, d)`, and both drivers
 * should be reading the same shape of query.
 */
const PAGE_ORDER = `ORDER BY n.updated_at DESC, n.id DESC LIMIT @limit`;
const AFTER_CURSOR = `AND (n.updated_at < @afterUpdatedAt
  OR (n.updated_at = @afterUpdatedAt AND n.id < @afterId))`;
const MATCHES = `AND (LOWER(n.title) LIKE LOWER(@like)
  OR LOWER(n.content) LIKE LOWER(@like))`;

/** The user's own notes. */
const OWN_FROM = `SELECT ${LIST_COLUMNS.map((c) => `n.${c}`).join(", ")}
  FROM notes n WHERE n.user_id = @userId`;

/** Notes shared with the user that they accepted and the owner has not
 * trashed, with their personal columns alongside. */
const SHARED_FROM = `SELECT ${LIST_COLUMNS.map((c) => `n.${c}`).join(", ")},
  ${SHARE_OVERLAY_COLUMNS}
  FROM note_shares s JOIN notes n ON n.id = s.note_id
  WHERE s.user_id = @userId AND s.accepted_at IS NOT NULL AND n.trashed = 0`;

interface OwnerRow {
  user_id: string;
  trashed: number;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function createSqliteNotesRepo(db: SqliteDB): NotesRepo {
  const own = {
    first: db.prepare(`${OWN_FROM} ${PAGE_ORDER}`),
    after: db.prepare(`${OWN_FROM} ${AFTER_CURSOR} ${PAGE_ORDER}`),
    search: db.prepare(`${OWN_FROM} ${MATCHES} ${PAGE_ORDER}`),
    searchAfter: db.prepare(
      `${OWN_FROM} ${MATCHES} ${AFTER_CURSOR} ${PAGE_ORDER}`,
    ),
  };
  const shared = {
    first: db.prepare(`${SHARED_FROM} ${PAGE_ORDER}`),
    after: db.prepare(`${SHARED_FROM} ${AFTER_CURSOR} ${PAGE_ORDER}`),
    search: db.prepare(`${SHARED_FROM} ${MATCHES} ${PAGE_ORDER}`),
    searchAfter: db.prepare(
      `${SHARED_FROM} ${MATCHES} ${AFTER_CURSOR} ${PAGE_ORDER}`,
    ),
  };
  const getStmt = db.prepare(
    `SELECT n.*, ${SHARE_OVERLAY_COLUMNS}
     FROM notes n
     LEFT JOIN note_shares s
       ON s.note_id = n.id AND s.user_id = @userId
      AND s.accepted_at IS NOT NULL
     WHERE n.id = @id
       AND (n.user_id = @userId OR (s.role IS NOT NULL AND n.trashed = 0))`,
  );
  const ownerStmt = db.prepare(
    `SELECT user_id, trashed FROM notes WHERE id = ?`,
  );
  const acceptedRoleStmt = db.prepare(
    `SELECT role FROM note_shares
     WHERE note_id = ? AND user_id = ? AND accepted_at IS NOT NULL`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO notes (${INSERT_COLUMNS.join(", ")})
     VALUES (${INSERT_COLUMNS.map(() => "?").join(", ")})`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM notes WHERE id = ? AND user_id = ?`,
  );

  /** The notes as `viewerId` sees them, with `sharing` where they have
   * members. */
  function view(rows: ViewRow[], viewerId: string, listed: boolean): Note[] {
    const notes = rows.map((row) => rowToViewNote(row, listed));
    if (rows.length === 0) return notes;
    const ids = rows.map((row) => row.id);
    const members = db
      .prepare(
        `SELECT s.note_id, s.user_id, s.role, s.created_at, s.accepted_at,
                u.username, u.display_name, u.avatar_color
         FROM note_shares s JOIN users u ON u.id = s.user_id
         WHERE s.note_id IN (${placeholders(ids.length)})`,
      )
      .all(ids) as MemberRow[];
    if (members.length === 0) return notes;
    const ownerIds = ownerIdsOf(rows);
    const users = db
      .prepare(
        `SELECT id, username, display_name, avatar_color FROM users
         WHERE id IN (${placeholders(ownerIds.length)})`,
      )
      .all(ownerIds) as UserBriefRow[];
    return attachSharing(rows, notes, viewerId, members, users);
  }

  function page(
    userId: string,
    like: string | null,
    { limit, cursor }: ListNotesOptions,
  ): NotePage {
    // Both halves over-fetch by one, so the presence of a next page is a fact
    // about the rows rather than a second COUNT query.
    const after = cursor ? decodeCursor(cursor) : null;
    const params = {
      userId,
      limit: limit + 1,
      ...(like !== null && { like }),
      ...(after && { afterUpdatedAt: after.updatedAt, afterId: after.id }),
    };
    const pick = (set: typeof own) =>
      like === null
        ? after
          ? set.after
          : set.first
        : after
          ? set.searchAfter
          : set.search;
    const rows = mergePages(
      pick(own).all(params) as ViewRow[],
      pick(shared).all(params) as ViewRow[],
      limit,
    );
    const { page: kept, nextCursor } = splitPage(rows, limit);
    return { notes: view(kept, userId, true), nextCursor };
  }

  /**
   * A recipient's write, as one transaction: their role is read and the note's
   * `updated_at` compared in the same lock that writes both rows, so a share
   * revoked or downgraded a moment earlier cannot slip one past.
   */
  const recipientUpdate = db.transaction(
    (
      id: string,
      userId: string,
      changes: NoteUpdate,
      updatedAt: string,
      expectedUpdatedAt: string | undefined,
    ): boolean => {
      const share = acceptedRoleStmt.get(id, userId) as
        | { role: string }
        | undefined;
      if (!share) return false;
      const split = splitChanges(changes);
      const forbidden = forbiddenFields(parseRole(share.role), split);
      if (forbidden.length > 0) throw new NoteAccessError(forbidden);

      const note = noteUpdateColumns(split.shared, "integer");
      const params = [...note.values, updatedAt, id];
      let where = `WHERE id = ? AND trashed = 0`;
      if (expectedUpdatedAt !== undefined) {
        where += ` AND updated_at = ?`;
        params.push(expectedUpdatedAt);
      }
      const assignments = [...note.columns, "updated_at"].map(
        (column) => `${column} = ?`,
      );
      const info = db
        .prepare(`UPDATE notes SET ${assignments.join(", ")} ${where}`)
        .run(params);
      if (info.changes === 0) return false;

      const personal = noteUpdateColumns(split.personal, "integer");
      if (personal.columns.length > 0) {
        db.prepare(
          `UPDATE note_shares SET ${personal.columns
            .map((column) => `${column} = ?`)
            .join(", ")}
           WHERE note_id = ? AND user_id = ?`,
        ).run([...personal.values, id, userId]);
      }
      return true;
    },
  );

  const repo: NotesRepo = {
    async listByUser(
      userId: string,
      options: ListNotesOptions,
    ): Promise<NotePage> {
      return page(userId, null, options);
    },

    async getById(id: string, userId: string): Promise<Note | null> {
      const row = getStmt.get({ id, userId }) as ViewRow | undefined;
      return row ? (view([row], userId, false)[0] ?? null) : null;
    },

    async access(id: string, userId: string): Promise<NoteAccess | null> {
      const note = ownerStmt.get(id) as OwnerRow | undefined;
      if (!note) return null;
      if (note.user_id === userId) {
        return { role: "owner", ownerId: note.user_id };
      }
      if (note.trashed === 1) return null;
      const share = acceptedRoleStmt.get(id, userId) as
        | { role: string }
        | undefined;
      return share
        ? { role: parseRole(share.role), ownerId: note.user_id }
        : null;
    },

    async insert(input: InsertNoteInput): Promise<Note> {
      insertStmt.run(noteInsertValues(input, "integer"));
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
      const owner = ownerStmt.get(id) as OwnerRow | undefined;
      if (!owner) return null;
      if (owner.user_id !== userId) {
        const written = recipientUpdate.immediate(
          id,
          userId,
          changes,
          updatedAt,
          expectedUpdatedAt,
        );
        return written ? await repo.getById(id, userId) : null;
      }
      const { columns, values } = noteUpdateColumns(changes, "integer");
      const assignments = [...columns, "updated_at"].map(
        (column) => `${column} = ?`,
      );
      const params = [...values, updatedAt, id, userId];
      // Compare-and-set on `updated_at` when the caller passed `If-Match`;
      // collapses the prior read-then-write race into a single atomic write.
      let where = `WHERE id = ? AND user_id = ?`;
      if (expectedUpdatedAt !== undefined) {
        where += ` AND updated_at = ?`;
        params.push(expectedUpdatedAt);
      }
      const sql = `UPDATE notes SET ${assignments.join(", ")} ${where}`;
      const info = db.prepare(sql).run(params);
      if (info.changes === 0) return null;
      return await repo.getById(id, userId);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const info = deleteStmt.run(id, userId);
      return info.changes > 0;
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
