import type {
  AutoNoteSource,
  LinkPreview,
  Note,
  NoteReminder,
  NoteUpdate,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";

/**
 * The `notes` row as either driver returns it, and the mapping between it and
 * the `Note` the rest of the server deals in.
 *
 * Both drivers store the same shape — the only real difference is that SQLite
 * has no boolean type, so its flags come back as 0/1 where Postgres returns
 * `true`/`false`. Everything else about a row (which columns exist, what JSON
 * lives in them, which fields an update may touch) was written out twice, and
 * a change to the note schema had to be made in both places or the drivers
 * would quietly disagree about what a note is.
 */

/** A flag column, as one driver or the other returns it. */
type RowBoolean = boolean | number;

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  color: string;
  font: string;
  pinned: RowBoolean;
  archived: RowBoolean;
  trashed: RowBoolean;
  trashed_at: string | null;
  position: number | string;
  tags: string;
  images: string;
  link_previews: string;
  reminder: string | null;
  readonly: RowBoolean;
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

/** `false !== 0` is true, so a driver's own flags cannot be read as numbers. */
function asBoolean(raw: RowBoolean): boolean {
  return raw === true || raw === 1;
}

export function rowToNote(row: NoteRow): Note {
  const note: Note = {
    id: row.id,
    title: row.title,
    content: row.content,
    color: parseColor(row.color),
    font: parseFont(row.font),
    pinned: asBoolean(row.pinned),
    archived: asBoolean(row.archived),
    trashed: asBoolean(row.trashed),
    trashedAt: row.trashed_at,
    // Postgres hands back wide integer types as strings.
    position: Number(row.position),
    tags: parseJson<string[]>(row.tags, []),
    images: parseJson<string[]>(row.images, []),
    linkPreviews: parseJson<LinkPreview[]>(row.link_previews, []),
    reminder: parseJson<NoteReminder | null>(row.reminder, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (asBoolean(row.readonly)) note.readonly = true;
  const source = parseJson<AutoNoteSource | null>(row.source, null);
  if (source) note.source = source;
  return note;
}

/** Every field of a note an update may touch, and its column. */
const FIELD_TO_COLUMN = {
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
} as const satisfies Record<string, string>;

type UpdatableField = keyof typeof FIELD_TO_COLUMN;

const NOTE_FIELDS = Object.keys(FIELD_TO_COLUMN) as UpdatableField[];

/**
 * The columns an insert writes, in order. `noteInsertValues` returns its
 * values in the same order, so the two cannot drift apart.
 */
export const INSERT_COLUMNS = [
  "id",
  "user_id",
  ...NOTE_FIELDS.map((field) => FIELD_TO_COLUMN[field]),
  "created_at",
  "updated_at",
] as const;

/** How a driver spells a boolean: SQLite has no type for one. */
export type BooleanStyle = "integer" | "native";

export type ColumnValue = string | number | boolean | null;

/**
 * One field's value for its column. An absent field takes the column's
 * default, which is what makes this usable for an insert as well as an
 * update — and is why `position` no longer becomes `NaN` when an update
 * carries the key with nothing in it.
 */
function toColumnValue(
  field: UpdatableField,
  value: unknown,
  booleans: BooleanStyle,
): ColumnValue {
  switch (field) {
    case "pinned":
    case "archived":
    case "trashed":
    case "readonly":
      return booleans === "integer" ? (value ? 1 : 0) : Boolean(value);
    case "trashedAt":
      return (value as string | null | undefined) ?? null;
    case "reminder":
    case "source":
      return value === null || value === undefined
        ? null
        : JSON.stringify(value);
    case "position":
      return Number(value ?? 0);
    case "tags":
    case "images":
    case "linkPreviews":
      return JSON.stringify(value ?? []);
    case "color":
      return (value as string | undefined) ?? NoteColor.Default;
    case "font":
      return (value as string | undefined) ?? NoteFont.Default;
    default:
      return (value as string | null | undefined) ?? "";
  }
}

/**
 * The columns an update should set and the values to set them to, in matching
 * order. The driver adds its own placeholder syntax and its own `WHERE`.
 */
export function noteUpdateColumns(
  changes: NoteUpdate,
  booleans: BooleanStyle,
): { columns: string[]; values: ColumnValue[] } {
  const columns: string[] = [];
  const values: ColumnValue[] = [];
  for (const field of NOTE_FIELDS) {
    if (!(field in changes)) continue;
    columns.push(FIELD_TO_COLUMN[field]);
    values.push(
      toColumnValue(
        field,
        (changes as Record<string, unknown>)[field],
        booleans,
      ),
    );
  }
  return { columns, values };
}

/** The values for `INSERT_COLUMNS`, in that order. */
export function noteInsertValues(
  input: {
    id: string;
    userId: string;
    data: Partial<Record<UpdatableField, unknown>>;
    createdAt: string;
    updatedAt: string;
  },
  booleans: BooleanStyle,
): ColumnValue[] {
  const { data } = input;
  return [
    input.id,
    input.userId,
    ...NOTE_FIELDS.map((field) => toColumnValue(field, data[field], booleans)),
    input.createdAt,
    input.updatedAt,
  ];
}

/**
 * The `LIKE` pattern for a search, or null when there is nothing left to
 * search for. Wildcards are stripped rather than escaped: a bare `%` would
 * otherwise match every note, and SQL `ESCAPE` is not available to us because
 * pg-mem — which the Postgres driver's tests run against — does not parse it.
 */
export function searchPattern(query: string): string | null {
  const sanitized = query.replace(/[%_]/g, "");
  return sanitized.length === 0 ? null : `%${sanitized}%`;
}
