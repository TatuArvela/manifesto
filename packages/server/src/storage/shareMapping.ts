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

/** An offered key as stored, or null for none or anything else. */
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
 * Whether a share's holder was ever handed the note's key: offered it with
 * the invitation, or keeping it since. When such a share ends, the note is
 * due a new key.
 */
export function heldKey(row: ShareRow): boolean {
  return (
    parseOffered(row.offered_key) !== null ||
    Number(row.wrapped_key_version ?? 0) > 0
  );
}

/**
 * Whether a share's holder has nothing that opens the note at `keyVersion`:
 * no copy of that key under their own notes key, and none offered to them.
 */
function waitsForKey(row: ShareRow, keyVersion: number): boolean {
  if (Number(row.wrapped_key_version ?? 0) === keyVersion) return false;
  return parseOffered(row.offered_key)?.keyVersion !== keyVersion;
}

/** A share with the account it belongs to, and the team it came through. */
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
    viaTeam: row.via_team ?? null,
  };
}

/** The team a row came through, as a note or an invitation names it. */
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
    // Only one for the key the note is under now: an older one opens
    // nothing the invitation shows.
    offered:
      parseOffered(row.offered_key)?.keyVersion === Number(row.key_version)
        ? parseOffered(row.offered_key)
        : null,
    invitedAt: row.created_at,
    ...teamOf(row),
  };
}

/**
 * The note as its reader sees it. A row that came through a share takes the
 * recipient's own personal fields, their own trash included, and their own
 * wrapped copy of the note key. The owner's trash never shows here: a note in
 * it does not reach anyone else at all.
 */
export function rowToViewNote(row: ViewRow): SealedNote {
  const note = rowToNote(row);
  if (row.s_role === null || row.s_role === undefined) return note;
  // Their copy of the key, while it is the key the note is under. Behind
  // it, they hold nothing that opens the note, and are handed the offer
  // that would.
  // Replacing the key is the owner's to do.
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
 * Adds `sharing` to every note that has members. `rows` and `notes` run in
 * the same order. The owner hears about invitations still waiting for an
 * answer; a recipient sees only the people who accepted.
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

/** The user ids whose names `attachSharing` needs: every note's owner. */
export function ownerIdsOf(rows: ViewRow[]): string[] {
  return [...new Set(rows.map((row) => row.user_id))];
}

const SHARED_FIELDS = new Set<string>(SEALED_SHARED_NOTE_FIELDS);
const PERSONAL_FIELDS = new Set<string>(SEALED_PERSONAL_NOTE_FIELDS);

/**
 * A recipient's update, split by where each field is written: the shared
 * fields to the note, the personal ones (their own trash among them) to their
 * share, and the rest (auto-note markers) belonging to the owner alone.
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

/**
 * The time a membership change is stamped with, as `notes.members_changed_at`.
 * Taken here rather than from the caller because only `GET /api/sync` reads
 * it, and a removal or a role change has no other time of its own to pass
 * down. The clock is the one `updated_at` is stamped from.
 */
export function membersChangedAt(): string {
  return nowIso();
}
