import type {
  AutoNoteSource,
  LinkPreview,
  Note,
  NoteCreate,
  NoteReminder,
  NoteUpdate,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import type { DB } from "../index.js";

interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  color: string;
  font: string;
  pinned: number;
  archived: number;
  trashed: number;
  trashed_at: string | null;
  position: number;
  tags: string;
  images: string;
  link_previews: string;
  reminder: string | null;
  readonly: number;
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
    pinned: row.pinned !== 0,
    archived: row.archived !== 0,
    trashed: row.trashed !== 0,
    trashedAt: row.trashed_at,
    position: row.position,
    tags: parseJson<string[]>(row.tags, []),
    images: parseJson<string[]>(row.images, []),
    linkPreviews: parseJson<LinkPreview[]>(row.link_previews, []),
    reminder: parseJson<NoteReminder | null>(row.reminder, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.readonly !== 0) note.readonly = true;
  const source = parseJson<AutoNoteSource | null>(row.source, null);
  if (source) note.source = source;
  return note;
}

export interface InsertNoteInput {
  id: string;
  userId: string;
  data: NoteCreate;
  createdAt: string;
  updatedAt: string;
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
): string | number | null | Buffer {
  switch (field) {
    case "pinned":
    case "archived":
    case "trashed":
    case "readonly":
      return value ? 1 : 0;
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

export function createNotesRepo(db: DB) {
  const listStmt = db.prepare(
    `SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC`,
  );
  const getStmt = db.prepare(
    `SELECT * FROM notes WHERE id = ? AND user_id = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO notes (
      id, user_id, title, content, color, font, pinned, archived, trashed,
      trashed_at, position, tags, images, link_previews, reminder, readonly,
      source, created_at, updated_at
    ) VALUES (
      @id, @userId, @title, @content, @color, @font, @pinned, @archived, @trashed,
      @trashedAt, @position, @tags, @images, @linkPreviews, @reminder, @readonly,
      @source, @createdAt, @updatedAt
    )`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM notes WHERE id = ? AND user_id = ?`,
  );
  const searchStmt = db.prepare(
    `SELECT * FROM notes
     WHERE user_id = ?
       AND (LOWER(title) LIKE LOWER(?) OR LOWER(content) LIKE LOWER(?))
     ORDER BY updated_at DESC`,
  );

  return {
    async listByUser(userId: string): Promise<Note[]> {
      const rows = listStmt.all(userId) as NoteRow[];
      return rows.map(rowToNote);
    },

    async getById(id: string, userId: string): Promise<Note | null> {
      const row = getStmt.get(id, userId) as NoteRow | undefined;
      return row ? rowToNote(row) : null;
    },

    async insert(input: InsertNoteInput): Promise<Note> {
      const { id, userId, data, createdAt, updatedAt } = input;
      insertStmt.run({
        id,
        userId,
        title: data.title ?? "",
        content: data.content ?? "",
        color: data.color ?? NoteColor.Default,
        font: data.font ?? NoteFont.Default,
        pinned: data.pinned ? 1 : 0,
        archived: data.archived ? 1 : 0,
        trashed: data.trashed ? 1 : 0,
        trashedAt: data.trashedAt ?? null,
        position: data.position ?? 0,
        tags: JSON.stringify(data.tags ?? []),
        images: JSON.stringify(data.images ?? []),
        linkPreviews: JSON.stringify(data.linkPreviews ?? []),
        reminder: data.reminder ? JSON.stringify(data.reminder) : null,
        readonly: data.readonly ? 1 : 0,
        source: data.source ? JSON.stringify(data.source) : null,
        createdAt,
        updatedAt,
      });
      const note = await this.getById(id, userId);
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
      const params: Record<string, string | number | null | Buffer> = {
        id,
        userId,
      };
      for (const field of NOTE_FIELDS) {
        if (!(field in changes)) continue;
        const value = (changes as Record<string, unknown>)[field];
        const column = FIELD_TO_COLUMN[field];
        setClauses.push(`${column} = @${field}`);
        params[field] = fieldToColumnValue(field, value);
      }
      setClauses.push(`updated_at = @updatedAt`);
      params.updatedAt = updatedAt;
      const sql = `UPDATE notes SET ${setClauses.join(", ")}
                   WHERE id = @id AND user_id = @userId`;
      const stmt = db.prepare(sql);
      const info = stmt.run(params);
      if (info.changes === 0) return null;
      return await this.getById(id, userId);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const info = deleteStmt.run(id, userId);
      return info.changes > 0;
    },

    async search(userId: string, query: string): Promise<Note[]> {
      const like = `%${query}%`;
      const rows = searchStmt.all(userId, like, like) as NoteRow[];
      return rows.map(rowToNote);
    },
  };
}

export type NotesRepo = ReturnType<typeof createNotesRepo>;
export { rowToNote };
