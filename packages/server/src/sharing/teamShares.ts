import type { ShareRole } from "@manifesto/shared";
import { nowIso } from "../lib/time.js";
import type { NoteShare, StorageDriver } from "../storage/types.js";
import type { AccessChanges } from "./accessChanges.js";
import type { NoteEvents } from "./noteEvents.js";

/**
 * What sharing a note with a team means for each of its members.
 *
 * A team share is a `note_team_shares` row, and for each member an ordinary
 * `note_shares` row marked with the team it came through (`viaTeam`). It
 * arrives as an invitation, like a share to one person. Everything that
 * decides who may read or write a note keeps reading `note_shares` alone, so
 * this is the only place teams have to be understood.
 *
 * The rules, in one place:
 * - A share made to someone directly is never touched by a team: they are
 *   not invited again, their role is not changed, and they are not removed
 *   when the team share goes.
 * - Someone who has a note through two teams holds one share, through the
 *   first. When that team's share goes, or they leave that team, the share
 *   passes to the other team, with its role, instead of being taken away.
 * - Joining a team brings invitations to its notes; leaving it takes away
 *   what came through it. Declining, or leaving a note, is not undone by
 *   anything but joining again or the note being shared with the team again.
 * - The owner is never a recipient of their own note.
 */
export interface TeamShares {
  /** Share a note with a team, inviting its members. False if it already
   * was. */
  share(
    noteId: string,
    ownerId: string,
    teamId: string,
    role: ShareRole,
  ): Promise<boolean>;
  /** Change the role a team has; its members' shares follow. */
  setRole(noteId: string, teamId: string, role: ShareRole): Promise<boolean>;
  /** Stop sharing a note with a team. False if it was not. */
  unshare(noteId: string, teamId: string): Promise<boolean>;
  /** Someone joined a team: invite them to its notes. */
  joined(teamId: string, userId: string): Promise<void>;
  /** Someone left a team: take away what came through it. */
  left(teamId: string, userId: string): Promise<void>;
  /** Take a team's notes away from its members, before the team goes. */
  dissolve(teamId: string): Promise<void>;
}

export function createTeamShares(deps: {
  storage: StorageDriver;
  noteEvents: NoteEvents;
  accessChanges: AccessChanges;
}): TeamShares {
  const { storage, noteEvents, accessChanges } = deps;

  async function invite(
    noteId: string,
    userId: string,
    role: ShareRole,
    teamId: string,
  ): Promise<boolean> {
    const created = await storage.shares.create({
      noteId,
      userId,
      role,
      createdAt: nowIso(),
      viaTeam: teamId,
    });
    if (created === "exists") return false;
    await noteEvents.invited(noteId, userId);
    return true;
  }

  /**
   * A share that came through `teamId`, which no longer carries it. Passed to
   * another team the note is shared with and the user is in, or ended.
   * Returns the share when it ended.
   */
  async function release(
    share: NoteShare,
    teamId: string,
  ): Promise<NoteShare | null> {
    for (const other of await storage.teams.sharesOfNote(share.noteId)) {
      if (other.teamId === teamId) continue;
      const members = await storage.teams.members(other.teamId);
      if (!members.includes(share.userId)) continue;
      await storage.shares.setViaTeam(share.noteId, share.userId, other.teamId);
      if (other.role !== share.role) {
        await applyRole(share, other.role);
      }
      return null;
    }
    return storage.shares.delete(share.noteId, share.userId);
  }

  /** A share's role changed: tell the member, as a direct change would. */
  async function applyRole(share: NoteShare, role: ShareRole): Promise<void> {
    await storage.shares.setRole(share.noteId, share.userId, role);
    if (share.acceptedAt === null) {
      await noteEvents.invited(share.noteId, share.userId);
    } else if (role === "view") {
      accessChanges.announce({
        noteId: share.noteId,
        userIds: [share.userId],
        change: "lost-edit",
      });
    }
  }

  async function throughTeam(
    noteId: string,
    teamId: string,
  ): Promise<NoteShare[]> {
    const audience = await storage.shares.audience(noteId);
    return (audience?.shares ?? []).filter((s) => s.viaTeam === teamId);
  }

  async function unshare(noteId: string, teamId: string): Promise<boolean> {
    if (!(await storage.teams.unshareNote(noteId, teamId))) return false;
    const ended: NoteShare[] = [];
    for (const share of await throughTeam(noteId, teamId)) {
      const gone = await release(share, teamId);
      if (gone) ended.push(gone);
    }
    noteEvents.ended(ended);
    await noteEvents.changed(noteId);
    return true;
  }

  return {
    async share(noteId, ownerId, teamId, role) {
      const added = await storage.teams.shareNote({
        noteId,
        teamId,
        role,
        createdAt: nowIso(),
      });
      if (!added) return false;
      for (const userId of await storage.teams.members(teamId)) {
        if (userId === ownerId) continue;
        await invite(noteId, userId, role, teamId);
      }
      await noteEvents.changed(noteId);
      return true;
    },

    async setRole(noteId, teamId, role) {
      if (!(await storage.teams.setNoteRole(noteId, teamId, role))) {
        return false;
      }
      for (const share of await throughTeam(noteId, teamId)) {
        if (share.role !== role) await applyRole(share, role);
      }
      await noteEvents.changed(noteId);
      return true;
    },

    unshare,

    async joined(teamId, userId) {
      for (const shared of await storage.teams.notesOf(teamId)) {
        const audience = await storage.shares.audience(shared.noteId);
        // A note in its owner's trash is invited to as well: the invitation
        // stays out of view until the owner restores the note, which offers
        // it then, as it does every pending invitation.
        if (!audience || audience.ownerId === userId) {
          continue;
        }
        if (await invite(shared.noteId, userId, shared.role, teamId)) {
          await noteEvents.changed(shared.noteId);
        }
      }
    },

    async left(teamId, userId) {
      for (const shared of await storage.teams.notesOf(teamId)) {
        const share = (await throughTeam(shared.noteId, teamId)).find(
          (s) => s.userId === userId,
        );
        if (!share) continue;
        const gone = await release(share, teamId);
        if (gone) noteEvents.ended([gone]);
        await noteEvents.changed(shared.noteId);
      }
    },

    async dissolve(teamId) {
      for (const shared of await storage.teams.notesOf(teamId)) {
        await unshare(shared.noteId, teamId);
      }
    },
  };
}
