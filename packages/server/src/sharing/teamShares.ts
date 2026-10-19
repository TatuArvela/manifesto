import type { ShareRole } from "@manifesto/shared";
import { nowIso } from "#/lib/time.ts";
import type { NoteShare, StorageDriver } from "#/storage/types.ts";
import type { AccessChanges } from "./accessChanges.ts";
import type { NoteEvents } from "./noteEvents.ts";

/**
 * What a share of a note with a team means for each of its members.
 *
 * A team share is a `note_team_shares` row. For each member, it is a usual
 * `note_shares` row marked with the team through which it came (`viaTeam`). It
 * arrives as an invitation, as a share to one person. All code that decides who
 * can read or write a note continues to read only `note_shares`. Thus, this is
 * the only place that must understand teams.
 *
 * The rules, in one place:
 * - A team never changes a direct share. The person does not get a new
 *   invitation, their role does not change, and they are not removed when the
 *   team share goes.
 * - A person who has a note through two teams has one share, through the first
 *   team. When the share of that team goes, or they leave that team, the share
 *   moves to the other team, with its role. It is not taken away.
 * - When a person joins a team, they get invitations to its notes. When they
 *   leave it, they lose what came through it. Only these undo a decline or a
 *   leave: the person joins again, or the owner shares the note with the team
 *   again.
 * - The owner is never a recipient of their own note.
 */
export interface TeamShares {
  /**
   * Share a note with a team, and invite its members. `exists` if it was
   * already shared. `gone` if the team was removed in the meantime, with nobody
   * invited.
   */
  share(
    noteId: string,
    ownerId: string,
    teamId: string,
    role: ShareRole,
  ): Promise<"ok" | "exists" | "gone">;
  /** Change the role of a team. The shares of its members follow. */
  setRole(noteId: string, teamId: string, role: ShareRole): Promise<boolean>;
  /** Stop the share of a note with a team. False if there was none. */
  unshare(noteId: string, teamId: string): Promise<boolean>;
  /** A person joined a team: invite them to its notes. */
  joined(teamId: string, userId: string): Promise<void>;
  /** A person left a team: take away what came through it. */
  left(teamId: string, userId: string): Promise<void>;
  /** Take the notes of a team away from its members, before the team goes. */
  dissolve(teamId: string): Promise<void>;
  /**
   * End all that still comes through a team that is gone. The removal of a team
   * has several steps. A note shared with it, or a member put in it, between
   * two of them, leaves shares that `dissolve` never saw. Run this after the
   * team is deleted, and also in the code that invited through the team when it
   * finds the team gone. Thus, the code that finishes last cleans up.
   */
  settle(teamId: string): Promise<void>;
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
   * A share that came through `teamId`, which does not carry it now. It moves
   * to a different team with which the note is shared and that the user is in,
   * or it ends. Returns the share when it ended.
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
      // Removed while the share was on its way to it. Try the next.
      if (!(await storage.teams.get(other.teamId))) continue;
      if (other.role !== share.role) {
        await applyRole(share, other.role);
      }
      return null;
    }
    return storage.shares.delete(share.noteId, share.userId);
  }

  /** The role of a share changed. Tell the member, as for a direct change. */
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

  async function settle(teamId: string): Promise<void> {
    const ended: NoteShare[] = [];
    const noteIds = new Set<string>();
    for (const share of await storage.shares.listByTeam(teamId)) {
      const gone = await release(share, teamId);
      if (gone) ended.push(gone);
      noteIds.add(share.noteId);
    }
    noteEvents.ended(ended);
    for (const noteId of noteIds) await noteEvents.changed(noteId);
  }

  /** True, after the settle, when the team was removed in the meantime. */
  async function settledIfGone(teamId: string): Promise<boolean> {
    if (await storage.teams.get(teamId)) return false;
    await settle(teamId);
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
      if (!added) return "exists";
      for (const userId of await storage.teams.members(teamId)) {
        if (userId === ownerId) continue;
        await invite(noteId, userId, role, teamId);
      }
      if (await settledIfGone(teamId)) return "gone";
      await noteEvents.changed(noteId);
      return "ok";
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
        // A note in the trash of its owner also gets invitations. The
        // invitation stays hidden until the owner restores the note. Then it
        // shows, as all pending invitations do.
        if (!audience || audience.ownerId === userId) {
          continue;
        }
        if (await invite(shared.noteId, userId, shared.role, teamId)) {
          await noteEvents.changed(shared.noteId);
        }
      }
      await settledIfGone(teamId);
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

    settle,
  };
}
