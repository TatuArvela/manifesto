import type {
  AutoNoteSource,
  NoteReminder,
  SealedNote,
  SealedNoteUpdate,
} from "@manifesto/shared";
import { CIPHERTEXT_PREFIX, NoteColor, NoteFont } from "@manifesto/shared";
import { AT_REST, atRest } from "./atRest.ts";

/**
 * The `notes` row as both drivers return it, and the mapping between it and the
 * `SealedNote` that the other parts of the server use. The words of a note are
 * ciphertext in their columns. Nothing here opens one.
 *
 * Both drivers store the same shape. The only real difference is that SQLite
 * has no boolean type. Thus, its flags come back as 0/1, where Postgres returns
 * `true`/`false`. All other parts of a row (which columns exist, what JSON they
 * contain, which fields an update can change) were written two times. A change
 * to the note schema had to occur in both places. If not, the drivers would
 * silently disagree about what a note is.
 */

/** A flag column, as either driver returns it. */
export type RowBoolean = boolean | number;

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  excerpt?: string;
  color: string;
  font: string;
  wrapped_key?: string;
  key_version?: number | string;
  format?: number | string;
  previous_keys?: string;
  rekey_due?: number | string;
  reminder_key?: string;
  pinned: RowBoolean;
  archived: RowBoolean;
  trashed: RowBoolean;
  trashed_at: string | null;
  position: number | string;
  tags: string;
  /** The attachment references that `image_list` names, readable. */
  images?: string;
  /** The images of the note, sealed. */
  image_list?: string;
  link_previews: string;
  reminder: string | null;
  readonly: RowBoolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

const allNoteColors = new Set<string>(Object.values(NoteColor));
const allNoteFonts = new Set<string>(Object.values(NoteFont));

export function parseColor(raw: string): NoteColor {
  return allNoteColors.has(raw) ? (raw as NoteColor) : NoteColor.Default;
}

export function parseFont(raw: string): NoteFont {
  return allNoteFonts.has(raw) ? (raw as NoteFont) : NoteFont.Default;
}

export function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * A reminder as its column contains it, under the server key. A reminder that
 * does not open (its key is gone) is no reminder.
 */
export function storedReminder(
  raw: string | null | undefined,
): NoteReminder | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return parseJson<NoteReminder | null>(
    atRest.open(raw, AT_REST.reminder),
    null,
  );
}

/**
 * `false !== 0` is true. Thus, the code cannot read the flags of a driver as
 * numbers.
 */
export function asBoolean(raw: RowBoolean): boolean {
  return raw === true || raw === 1;
}

/**
 * A sealed column as it goes out: a ciphertext, or empty. The own color and
 * tags of a share start as the column defaults. These are not ciphertext, and
 * mean "never set". Nothing readable ever goes where a ciphertext belongs.
 */
export function sealedColumn(raw: string | null | undefined): string {
  return raw?.startsWith(CIPHERTEXT_PREFIX) ? raw : "";
}

/** The copy of the note key for the feed, which exists only with a reminder. */
export function setReminderKey(
  note: SealedNote,
  raw: string | null | undefined,
): void {
  const wrapped = note.reminder ? sealedColumn(raw) : "";
  if (wrapped) note.reminderKey = wrapped;
  else delete note.reminderKey;
}

export function rowToNote(row: NoteRow): SealedNote {
  const note: SealedNote = {
    id: row.id,
    key: sealedColumn(row.wrapped_key),
    keyVersion: Number(row.key_version ?? 1),
    format: Number(row.format ?? 1),
    title: sealedColumn(row.title),
    content: sealedColumn(row.content),
    excerpt: sealedColumn(row.excerpt),
    font: sealedColumn(row.font),
    images: sealedColumn(row.image_list),
    linkPreviews: sealedColumn(row.link_previews),
    color: sealedColumn(row.color),
    tags: sealedColumn(row.tags),
    pinned: asBoolean(row.pinned),
    archived: asBoolean(row.archived),
    trashed: asBoolean(row.trashed),
    trashedAt: row.trashed_at,
    // Postgres gives back wide integer types as strings.
    position: Number(row.position),
    reminder: storedReminder(row.reminder),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const previous = sealedColumn(row.previous_keys);
  if (previous) note.previousKeys = previous;
  if (Number(row.rekey_due ?? 0) === 1) note.rekeyDue = true;
  setReminderKey(note, row.reminder_key);
  if (asBoolean(row.readonly)) note.readonly = true;
  const source = parseJson<AutoNoteSource | null>(row.source, null);
  if (source) note.source = source;
  return note;
}

/** Each field of a note that an update can change, and its column. */
const FIELD_TO_COLUMN = {
  key: "wrapped_key",
  keyVersion: "key_version",
  format: "format",
  previousKeys: "previous_keys",
  reminderKey: "reminder_key",
  title: "title",
  content: "content",
  excerpt: "excerpt",
  color: "color",
  font: "font",
  pinned: "pinned",
  archived: "archived",
  trashed: "trashed",
  trashedAt: "trashed_at",
  position: "position",
  tags: "tags",
  images: "image_list",
  imageRefs: "images",
  linkPreviews: "link_previews",
  previewRefs: "preview_refs",
  reminder: "reminder",
  readonly: "readonly",
  source: "source",
} as const satisfies Record<string, string>;

type UpdatableField = keyof typeof FIELD_TO_COLUMN;

const NOTE_FIELDS = Object.keys(FIELD_TO_COLUMN) as UpdatableField[];

/**
 * The columns that an insert writes, in order. `noteInsertValues` returns its
 * values in the same order. Thus, the two always agree.
 */
export const INSERT_COLUMNS = [
  "id",
  "user_id",
  ...NOTE_FIELDS.map((field) => FIELD_TO_COLUMN[field]),
  "image_count",
  "created_at",
  "updated_at",
] as const;

/** How a driver writes a boolean. SQLite has no type for one. */
export type BooleanStyle = "integer" | "native";

export type ColumnValue = string | number | boolean | null;

/**
 * The value of one field for its column. An absent field gets the default of
 * the column. Thus, this works for an insert and for an update. For this
 * reason, `position` does not become `NaN` now when an update contains the key
 * with nothing in it.
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
      // When, and how it repeats. The server reads these to fire it. Thus, they
      // are under its own key, not under the key of the account.
      return value === null || value === undefined
        ? null
        : atRest.seal(JSON.stringify(value), AT_REST.reminder);
    case "source":
      return value === null || value === undefined
        ? null
        : JSON.stringify(value);
    case "position":
      return Number(value ?? 0);
    case "keyVersion":
    case "format":
      return Number(value ?? 1);
    case "imageRefs":
    case "previewRefs":
      return JSON.stringify(value ?? []);
    default:
      return (value as string | null | undefined) ?? "";
  }
}

/**
 * The words of a note that one format covers. `excerpt` comes with `content`.
 */
const WORD_FIELDS = [
  "title",
  "content",
  "font",
  "images",
  "linkPreviews",
] as const satisfies readonly UpdatableField[];

/**
 * If a change contains all words of a note, as a move to a newer format must.
 */
export function carriesEveryWord(changes: SealedNoteUpdate): boolean {
  return WORD_FIELDS.every((field) => changes[field] !== undefined);
}

/**
 * What the `format` of a write checks it against, for the driver to add to its
 * `WHERE` with its own placeholder: the own format of the note or, for a write
 * that contains all words, that format or an older one, which the write makes
 * newer. The server refuses a write in an older format than that of the note.
 * Thus, an outdated app never writes over words that it would read incorrectly.
 * It also refuses a write that moves a part of a note to a newer format, and
 * leaves the other parts behind. Null for a write that contains no words, which
 * no format concerns.
 */
export function formatCondition(
  changes: SealedNoteUpdate,
): { op: "=" | "<="; value: number } | null {
  if (changes.format === undefined) return null;
  return {
    op: carriesEveryWord(changes) ? "<=" : "=",
    value: changes.format,
  };
}

/**
 * The columns that an update must set, and their values, in the same order. The
 * driver adds its own placeholder syntax and its own `WHERE`.
 *
 * The code calculates `image_count` here, and does not accept it from a caller.
 * Thus, it always agrees with the column that it counts.
 */
export function noteUpdateColumns(
  changes: SealedNoteUpdate & { previousKeys?: string },
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
    if (field === "imageRefs") {
      columns.push("image_count");
      values.push(changes.imageRefs?.length ?? 0);
    }
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
    (data.imageRefs as string[] | undefined)?.length ?? 0,
    input.createdAt,
    input.updatedAt,
  ];
}

/**
 * The `LIKE` pattern for a search, or null when there is nothing left to search
 * for. The code removes wildcards, and does not escape them. A bare `%` would
 * otherwise match all rows. We cannot use SQL `ESCAPE`, because pg-mem (against
 * which the tests of the Postgres driver run) does not parse it.
 */
export function searchPattern(query: string): string | null {
  const sanitized = query.replace(/[%_]/g, "");
  return sanitized.length === 0 ? null : `%${sanitized}%`;
}

/**
 * The position of a listing in the order, as an opaque string.
 *
 * Notes are in the order `updated_at DESC, id DESC`, because the timestamp
 * alone is not a key. Two notes saved in the same millisecond would make a page
 * boundary ambiguous, and could lose or repeat one. The cursor contains both.
 * Thus, the next page starts exactly after the last row of this page, and a
 * note edited during the listing moves to the front, and does not show two
 * times.
 */
export interface NoteCursor {
  updatedAt: string;
  id: string;
}

export function encodeCursor(cursor: NoteCursor): string {
  return Buffer.from(`${cursor.updatedAt}\u0000${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

/** Null for all values that are not a cursor that this server wrote. */
export function decodeCursor(raw: string): NoteCursor | null {
  try {
    const [updatedAt, id, ...rest] = Buffer.from(raw, "base64url")
      .toString("utf8")
      .split("\u0000");
    if (rest.length > 0 || !updatedAt || !id) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

/**
 * Changes the one extra row into `nextCursor`. A driver asks for `limit + 1`
 * rows. If the extra row came back, there is another page, and the cursor is
 * the last row that the caller really gets.
 */
export function splitPage<R extends Pick<NoteRow, "id" | "updated_at">>(
  rows: R[],
  limit: number,
): { page: R[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    page,
    nextCursor:
      hasMore && last
        ? encodeCursor({ updatedAt: last.updated_at, id: last.id })
        : null,
  };
}
