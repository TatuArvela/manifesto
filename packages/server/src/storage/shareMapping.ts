import type {
  NoteMember,
  NoteRole,
  OfferedKey,
  SealedNote,
  SealedNoteUpdate,
  ShareInvitation,
  ShareRole,
  ShareUser,
  TeamRef,
} from "@manifesto/shared";
import {
  SEALED_PERSONAL_NOTE_FIELDS,
  SEALED_SHARED_NOTE_FIELDS,
  SHARE_ROLES,
} from "@manifesto/shared";
import { nowIso } from "#/lib/time.ts";
import {
  asBoolean,
  type NoteRow,
  parseJson,
  type RowBoolean,
  rowToNote,
  sealedColumn,
  setReminderKey,
  storedReminder,
} from "./noteMapping.ts";
import type { NoteShare } from "./types.ts";

/**
 * The mapping between shared notes as the drivers store them and as one user
 * sees them. It is written one time for both drivers, as `noteMapping.ts` is
 * for notes.
 *
 * A note has one row, that of the owner, which contains the own color, pin and
 * other fields of the owner. The copy of those of each recipient is in their
 * `note_shares` row. The view of a recipient is the note row with their share
 * over it. `rowToViewNote` does this. Each note with members also gets the list
 * of the members. `attachSharing` does this.
 */

/**
 * A note row and, when it reached the reader through a share, the personal
 * columns of that share under an `s_` prefix. Select them with
 * `SHARE_OVERLAY_COLUMNS`.
 */
export interface ViewRow extends NoteRow {
  s_role?: string | null;
  s_color?: string | null;
  s_pinned?: RowBoolean | null;
  s_archived?: RowBoolean | null;
  s_trashed?: RowBoolean | null;
  s_trashed_at?: string | null;
  s_position?: number | string | null;
  s_tags?: string | null;
  s_reminder?: string | null;
  s_reminder_key?: string | null;
  s_wrapped_key?: string | null;
  s_wrapped_key_version?: number | string | null;
  s_offered_key?: string | null;
}

/** For a query that joins `note_shares s` onto `notes n`. */
export const SHARE_OVERLAY_COLUMNS = [
  "s.role AS s_role",
  "s.color AS s_color",
  "s.pinned AS s_pinned",
  "s.archived AS s_archived",
  "s.trashed AS s_trashed",
  "s.trashed_at AS s_trashed_at",
  "s.position AS s_position",
  "s.tags AS s_tags",
  "s.reminder AS s_reminder",
  "s.reminder_key AS s_reminder_key",
  "s.wrapped_key AS s_wrapped_key",
  "s.wrapped_key_version AS s_wrapped_key_version",
  "s.offered_key AS s_offered_key",
].join(", ");

export interface ShareRow {
  note_id: string;
  user_id: string;
  role: string;
  created_at: string;
  accepted_at: string | null;
  via_team?: string | null;
  offered_key?: string | null;
  wrapped_key_version?: number | string | null;
}

/** An offered key as stored, or null for none or for all other values. */
export function parseOffered(
  raw: string | null | undefined,
): OfferedKey | null {
  const value = parseJson<Partial<OfferedKey> | null>(raw ?? null, null);
  return value &&
    typeof value.keyVersion === "number" &&
    typeof value.ephemeral === "string" &&
    typeof value.wrapped === "string" &&
    typeof value.signer === "string" &&
    typeof value.signature === "string"
    ? (value as OfferedKey)
    : null;
}

/**
 * If the holder of a share ever got the key of the note: with the invitation,
 * or kept since then. When such a share ends, the note is due a new key.
 */
export function heldKey(row: ShareRow): boolean {
  return (
    parseOffered(row.offered_key) !== null ||
    Number(row.wrapped_key_version ?? 0) > 0
  );
}

/**
 * If the holder of a share has nothing that opens the note at `keyVersion`: no
 * copy of that key under their own notes key, and no offer of it.
 */
function waitsForKey(row: ShareRow, keyVersion: number): boolean {
  if (Number(row.wrapped_key_version ?? 0) === keyVersion) return false;
  return parseOffered(row.offered_key)?.keyVersion !== keyVersion;
}

/** A share with its account, and the team through which it came. */
export interface MemberRow extends ShareRow {
  username: string;
  display_name: string;
  avatar_color: string;
  team_name?: string | null;
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
  font: string;
  key_version: number | string;
  offered_key: string | null;
  owner_id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  via_team?: string | null;
  team_name?: string | null;
}

/** A role read from the database. All unknown values are the smaller role. */
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
    viaTeam: row.via_team ?? null,
  };
}

/** The team through which a row came, as a note or an invitation names it. */
function teamOf(row: {
  via_team?: string | null;
  team_name?: string | null;
}): { team: TeamRef } | Record<string, never> {
  return row.via_team
    ? { team: { id: row.via_team, name: row.team_name ?? "" } }
    : {};
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
    title: sealedColumn(row.title),
    content: sealedColumn(row.content),
    font: sealedColumn(row.font),
    keyVersion: Number(row.key_version),
    // Only one for the current key of the note. An older one opens nothing that
    // the invitation shows.
    offered:
      parseOffered(row.offered_key)?.keyVersion === Number(row.key_version)
        ? parseOffered(row.offered_key)
        : null,
    invitedAt: row.created_at,
    ...teamOf(row),
  };
}

/**
 * The note as its reader sees it. A row that came through a share gets the own
 * personal fields of the recipient, with their own trash, and their own wrapped
 * copy of the note key. The trash of the owner never shows here, because a note
 * in it does not reach other persons.
 */
export function rowToViewNote(row: ViewRow): SealedNote {
  const note = rowToNote(row);
  if (row.s_role === null || row.s_role === undefined) return note;
  // Their copy of the key, while it is the current key of the note. When it is
  // behind, they have nothing that opens the note, and they get the offer that
  // would. Only the owner can replace the key.
  delete note.rekeyDue;
  const current = Number(row.s_wrapped_key_version ?? 0) === note.keyVersion;
  note.key = current ? sealedColumn(row.s_wrapped_key) : "";
  const offered = current ? null : parseOffered(row.s_offered_key);
  if (offered?.keyVersion === note.keyVersion) note.offered = offered;
  note.color = sealedColumn(row.s_color);
  note.pinned = asBoolean(row.s_pinned ?? false);
  note.archived = asBoolean(row.s_archived ?? false);
  note.position = Number(row.s_position ?? 0);
  note.tags = sealedColumn(row.s_tags);
  note.reminder = storedReminder(row.s_reminder);
  setReminderKey(note, row.s_reminder_key);
  note.trashed = asBoolean(row.s_trashed ?? false);
  note.trashedAt = row.s_trashed_at ?? null;
  return note;
}

/**
 * Adds `sharing` to each note that has members. `rows` and `notes` are in the
 * same order. The owner learns about invitations that still wait for an answer.
 * A recipient sees only the people who accepted.
 */
export function attachSharing(
  rows: ViewRow[],
  notes: SealedNote[],
  viewerId: string,
  members: MemberRow[],
  users: UserBriefRow[],
): SealedNote[] {
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
      ...teamOf(m),
      ...(waitsForKey(m, note.keyVersion) && { waitingForKey: true }),
    }));
    return {
      ...note,
      sharing: { role, owner: toShareUser(owner), members: memberList },
    };
  });
}

/** The user ids whose names `attachSharing` needs: the owner of each note. */
export function ownerIdsOf(rows: ViewRow[]): string[] {
  return [...new Set(rows.map((row) => row.user_id))];
}

const SHARED_FIELDS = new Set<string>(SEALED_SHARED_NOTE_FIELDS);
const PERSONAL_FIELDS = new Set<string>(SEALED_PERSONAL_NOTE_FIELDS);

/**
 * An update of a recipient, split by where each field goes: the shared fields
 * to the note, the personal fields (their own trash among them) to their share,
 * and the others (auto-note markers), which belong only to the owner.
 */
export function splitChanges(changes: SealedNoteUpdate): {
  shared: SealedNoteUpdate;
  personal: SealedNoteUpdate;
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
    shared: shared as SealedNoteUpdate,
    personal: personal as SealedNoteUpdate,
    ownerOnly,
  };
}

/**
 * The fields in an update that a role cannot write. Empty means that the update
 * is permitted.
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
 * Two pages in descending `(updated_at, id)` order, merged into one page of a
 * maximum of `limit + 1` rows. A listing reads the own notes of a user and the
 * notes shared with them as two queries that can use indexes, each with one row
 * more than necessary. The first `limit + 1` rows of the union are always among
 * those.
 */
export function mergePages(
  own: ViewRow[],
  shared: ViewRow[],
  limit: number,
): ViewRow[] {
  return [...own, ...shared].sort(newerFirst).slice(0, limit + 1);
}

/**
 * The time of a membership change, as `notes.members_changed_at`. The code
 * takes it here, not from the caller, because only `GET /api/v1/sync` reads it,
 * and a removal or a role change has no other time of its own to send. The
 * clock is the clock of `updated_at`.
 */
export function membersChangedAt(): string {
  return nowIso();
}
