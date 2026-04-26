import type {
  AutoNoteSource,
  LinkPreview,
  Note,
  NoteReminder,
  NoteUpdate,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import type { InsertNoteInput, NotesRepo } from "../types.js";
import type { PgPool } from "./database.js";

interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  color: string;
  font: string;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  trashed_at: string | null;
  position: number;
  tags: string;
  images: string;
  link_previews: string;
  reminder: string | null;
  readonly: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

const allNoteColors = new Set<string>(Object.values(NoteColor));
const allNoteFonts = new Set<string>(Object.values(NoteFont));

function parseColor(raw: string): NoteColor {
  return allNoteColors.has(raw) ? (raw as NoteColor) : NoteColor.Default;
}

function parseFont(raw: string): NoteFont {
  return allNoteFonts.has(raw) ? (raw as NoteFont) : NoteFont.Default;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToNote(row: NoteRow): Note {
  const note: Note = {
    id: row.id,
    title: row.title,
    content: row.content,
    color: parseColor(row.color),
    font: parseFont(row.font),
    pinned: row.pinned,
    archived: row.archived,
    trashed: row.trashed,
    trashedAt: row.trashed_at,
    position: Number(row.position),
    tags: parseJson<string[]>(row.tags, []),
    images: parseJson<string[]>(row.images, []),
    linkPreviews: parseJson<LinkPreview[]>(row.link_previews, []),
    reminder: parseJson<NoteReminder | null>(row.reminder, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.readonly) note.readonly = true;
  const source = parseJson<AutoNoteSource | null>(row.source, null);
  if (source) note.source = source;
  return note;
}

type UpdatableField =
  | "title"
  | "content"
  | "color"
  | "font"
  | "pinned"
  | "archived"
  | "trashed"
  | "trashedAt"
  | "position"
  | "tags"
  | "images"
  | "linkPreviews"
  | "reminder"
  | "readonly"
  | "source";

const NOTE_FIELDS: readonly UpdatableField[] = [
  "title",
  "content",
  "color",
  "font",
  "pinned",
  "archived",
  "trashed",
  "trashedAt",
  "position",
  "tags",
  "images",
  "linkPreviews",
  "reminder",
  "readonly",
  "source",
];

const FIELD_TO_COLUMN: Record<UpdatableField, string> = {
  title: "title",
  content: "content",
  color: "color",
  font: "font",
  pinned: "pinned",
  archived: "archived",
  trashed: "trashed",
  trashedAt: "trashed_at",
  position: "position",
  tags: "tags",
  images: "images",
  linkPreviews: "link_previews",
  reminder: "reminder",
  readonly: "readonly",
  source: "source",
};

function fieldToColumnValue(
  field: UpdatableField,
  value: unknown,
): string | number | boolean | null {
  switch (field) {
    case "pinned":
    case "archived":
    case "trashed":
    case "readonly":
      return Boolean(value);
    case "trashedAt":
      return (value as string | null | undefined) ?? null;
    case "position":
      return Number(value);
    case "tags":
    case "images":
    case "linkPreviews":
      return JSON.stringify(value ?? []);
    case "reminder":
      return value === null || value === undefined
        ? null
        : JSON.stringify(value);
    case "source":
      return value === null || value === undefined
        ? null
        : JSON.stringify(value);
    default:
      return (value as string | null | undefined) ?? "";
  }
}

export function createPostgresNotesRepo(pool: PgPool): NotesRepo {
  const repo: NotesRepo = {
    async listByUser(userId: string): Promise<Note[]> {
      const result = await pool.query<NoteRow>(
        `SELECT * FROM notes WHERE user_id = $1 ORDER BY updated_at DESC`,
        [userId],
      );
      return result.rows.map(rowToNote);
    },

    async getById(id: string, userId: string): Promise<Note | null> {
      const result = await pool.query<NoteRow>(
        `SELECT * FROM notes WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      const row = result.rows[0];
      return row ? rowToNote(row) : null;
    },

    async insert(input: InsertNoteInput): Promise<Note> {
      const { id, userId, data, createdAt, updatedAt } = input;
      await pool.query(
        `INSERT INTO notes (
          id, user_id, title, content, color, font, pinned, archived, trashed,
          trashed_at, position, tags, images, link_previews, reminder, readonly,
          source, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19
        )`,
        [
          id,
          userId,
          data.title ?? "",
          data.content ?? "",
          data.color ?? NoteColor.Default,
          data.font ?? NoteFont.Default,
          Boolean(data.pinned),
          Boolean(data.archived),
          Boolean(data.trashed),
          data.trashedAt ?? null,
          data.position ?? 0,
          JSON.stringify(data.tags ?? []),
          JSON.stringify(data.images ?? []),
          JSON.stringify(data.linkPreviews ?? []),
          data.reminder ? JSON.stringify(data.reminder) : null,
          Boolean(data.readonly),
          data.source ? JSON.stringify(data.source) : null,
          createdAt,
          updatedAt,
        ],
      );
      const note = await repo.getById(id, userId);
      if (!note) throw new Error(`Failed to retrieve inserted note ${id}`);
      return note;
    },

    async update(
      id: string,
      userId: string,
      changes: NoteUpdate,
      updatedAt: string,
    ): Promise<Note | null> {
      const setClauses: string[] = [];
      const values: Array<string | number | boolean | null> = [];
      let nextParam = 1;
      for (const field of NOTE_FIELDS) {
        if (!(field in changes)) continue;
        const value = (changes as Record<string, unknown>)[field];
        const column = FIELD_TO_COLUMN[field];
        setClauses.push(`${column} = $${nextParam++}`);
        values.push(fieldToColumnValue(field, value));
      }
      setClauses.push(`updated_at = $${nextParam++}`);
      values.push(updatedAt);
      const idParam = nextParam++;
      const userParam = nextParam++;
      values.push(id, userId);
      const sql = `UPDATE notes SET ${setClauses.join(", ")}
                   WHERE id = $${idParam} AND user_id = $${userParam}`;
      const result = await pool.query(sql, values);
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

    async search(userId: string, query: string): Promise<Note[]> {
      const like = `%${query}%`;
      const result = await pool.query<NoteRow>(
        `SELECT * FROM notes
         WHERE user_id = $1
           AND (LOWER(title) LIKE LOWER($2) OR LOWER(content) LIKE LOWER($3))
         ORDER BY updated_at DESC`,
        [userId, like, like],
      );
      return result.rows.map(rowToNote);
    },
  };

  return repo;
}
