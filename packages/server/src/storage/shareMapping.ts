import type {
  Note,
  NoteMember,
  NoteReminder,
  NoteRole,
  NoteUpdate,
  ShareInvitation,
  ShareRole,
  ShareUser,
} from "@manifesto/shared";
import {
  PERSONAL_NOTE_FIELDS,
  SHARE_ROLES,
  SHARED_NOTE_FIELDS,
} from "@manifesto/shared";
import {
  asBoolean,
  type NoteRow,
  parseColor,
  parseFont,
  parseJson,
  type RowBoolean,
  rowToListedNote,
  rowToNote,
} from "./noteMapping.js";
import type { NoteShare } from "./types.js";

/**
 * The mapping between shared notes as the drivers store them and as one user
 * sees them, written once for both drivers as `noteMapping.ts` is for notes.
 *
 * A note has one row, the owner's, holding the owner's own color, pin and the
 * rest. Each recipient's copy of those lives in their `note_shares` row. A
 * recipient's view is the note row with their share laid over it, which is
 * what `rowToViewNote` does, and every note with members also learns who they
 * are, which is `attachSharing`.
 */

/**
 * A note row, and when it reached the reader through a share, that share's
 * personal columns under an `s_` prefix. Select them with
 * `SHARE_OVERLAY_COLUMNS`.
 */
export interface ViewRow extends NoteRow {
  s_role?: string | null;
  s_color?: string | null;
  s_pinned?: RowBoolean | null;
  s_archived?: RowBoolean | null;
  s_position?: number | string | null;
  s_tags?: string | null;
  s_reminder?: string | null;
}

/** For a query that joins `note_shares s` onto `notes n`. */
export const SHARE_OVERLAY_COLUMNS = [
  "s.role AS s_role",
  "s.color AS s_color",
  "s.pinned AS s_pinned",
  "s.archived AS s_archived",
  "s.position AS s_position",
  "s.tags AS s_tags",
  "s.reminder AS s_reminder",
].join(", ");

export interface ShareRow {
  note_id: string;
  user_id: string;
  role: string;
  created_at: string;
  accepted_at: string | null;
}

/** A share with the account it belongs to. */
export interface MemberRow extends ShareRow {
  username: string;
  display_name: string;
  avatar_color: string;
}

export interface UserBriefRow {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
}

export interface InvitationRow {
  note_id: string;
  role: string;
  created_at: string;
  title: string;
  content: string;
  color: string;
  font: string;
  owner_id: string;
  username: string;
  display_name: string;
  avatar_color: string;
}

/** A role read from the database. Anything unknown is the lesser one. */
export function parseRole(raw: string | null | undefined): ShareRole {
  return raw === "edit" ? "edit" : "view";
}

export function isShareRole(value: unknown): value is ShareRole {
  return (SHARE_ROLES as readonly unknown[]).includes(value);
}

export function rowToShare(row: ShareRow): NoteShare {
  return {
    noteId: row.note_id,
    userId: row.user_id,
    role: parseRole(row.role),
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

export function toShareUser(row: UserBriefRow): ShareUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    avatarColor: row.avatar_color,
  };
}

export function rowToInvitation(row: InvitationRow): ShareInvitation {
  return {
    noteId: row.note_id,
    role: parseRole(row.role),
    owner: toShareUser({
      id: row.owner_id,
      username: row.username,
      display_name: row.display_name,
      avatar_color: row.avatar_color,
    }),
    title: row.title,
    content: row.content,
    color: parseColor(row.color),
    font: parseFont(row.font),
    invitedAt: row.created_at,
  };
}

/**
 * The note as its reader sees it. A row that came through a share takes the
 * recipient's own personal fields, and is never in the trash: the trash is the
 * owner's, and a trashed note does not reach anyone else at all.
 */
export function rowToViewNote(row: ViewRow, listed: boolean): Note {
  const note = listed ? rowToListedNote(row) : rowToNote(row);
  if (row.s_role === null || row.s_role === undefined) return note;
  note.color = parseColor(row.s_color ?? "");
  note.pinned = asBoolean(row.s_pinned ?? false);
  note.archived = asBoolean(row.s_archived ?? false);
  note.position = Number(row.s_position ?? 0);
  note.tags = parseJson<string[]>(row.s_tags ?? null, []);
  note.reminder = parseJson<NoteReminder | null>(row.s_reminder ?? null, null);
  note.trashed = false;
  note.trashedAt = null;
  return note;
}

/**
 * Adds `sharing` to every note that has members. `rows` and `notes` run in
 * the same order. The owner hears about invitations still waiting for an
 * answer; a recipient sees only the people who accepted.
 */
export function attachSharing(
  rows: ViewRow[],
  notes: Note[],
  viewerId: string,
  members: MemberRow[],
  users: UserBriefRow[],
): Note[] {
  const membersByNote = new Map<string, MemberRow[]>();
  for (const member of members) {
    const list = membersByNote.get(member.note_id) ?? [];
    list.push(member);
    membersByNote.set(member.note_id, list);
  }
  const usersById = new Map(users.map((user) => [user.id, user]));
  return notes.map((note, i) => {
    const row = rows[i];
    const noteMembers = membersByNote.get(note.id);
    const owner = row ? usersById.get(row.user_id) : undefined;
    if (!row || !noteMembers || noteMembers.length === 0 || !owner) {
      return note;
    }
    const role: NoteRole =
      row.user_id === viewerId ? "owner" : parseRole(row.s_role);
    const visible = noteMembers
      .filter((m) => role === "owner" || m.accepted_at !== null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const memberList: NoteMember[] = visible.map((m) => ({
      ...toShareUser({
        id: m.user_id,
        username: m.username,
        display_name: m.display_name,
        avatar_color: m.avatar_color,
      }),
      role: parseRole(m.role),
      accepted: m.accepted_at !== null,
    }));
    return {
      ...note,
      sharing: { role, owner: toShareUser(owner), members: memberList },
    };
  });
}

/** The user ids whose names `attachSharing` needs: every note's owner. */
export function ownerIdsOf(rows: ViewRow[]): string[] {
  return [...new Set(rows.map((row) => row.user_id))];
}

const SHARED_FIELDS = new Set<string>(SHARED_NOTE_FIELDS);
const PERSONAL_FIELDS = new Set<string>(PERSONAL_NOTE_FIELDS);

/**
 * A recipient's update, split by where each field is written: the shared
 * fields to the note, the personal ones to their share, and the rest (the
 * trash, auto-note markers) belonging to the owner alone.
 */
export function splitChanges(changes: NoteUpdate): {
  shared: NoteUpdate;
  personal: NoteUpdate;
  ownerOnly: string[];
} {
  const shared: Record<string, unknown> = {};
  const personal: Record<string, unknown> = {};
  const ownerOnly: string[] = [];
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (SHARED_FIELDS.has(field)) shared[field] = value;
    else if (PERSONAL_FIELDS.has(field)) personal[field] = value;
    else ownerOnly.push(field);
  }
  return {
    shared: shared as NoteUpdate,
    personal: personal as NoteUpdate,
    ownerOnly,
  };
}

/**
 * Which fields a role may not write, of those in an update. Empty means the
 * update is allowed.
 */
export function forbiddenFields(
  role: ShareRole,
  split: ReturnType<typeof splitChanges>,
): string[] {
  const forbidden = [...split.ownerOnly];
  if (role === "view") forbidden.push(...Object.keys(split.shared));
  return forbidden;
}

function newerFirst(a: ViewRow, b: ViewRow): number {
  if (a.updated_at !== b.updated_at) {
    return a.updated_at < b.updated_at ? 1 : -1;
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Two pages in `(updated_at, id)` descending order, merged into one of at
 * most `limit + 1` rows. A listing reads a user's own notes and those shared
 * with them as two index-friendly queries, each over-fetched by one, and the
 * first `limit + 1` of the union are always among those.
 */
export function mergePages(
  own: ViewRow[],
  shared: ViewRow[],
  limit: number,
): ViewRow[] {
  return [...own, ...shared].sort(newerFirst).slice(0, limit + 1);
}
