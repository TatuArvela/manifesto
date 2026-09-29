import type { AuditAction } from "@manifesto/shared";
import type { NoteShare } from "./sharing.js";

// The server's own housekeeping: cleanup, stats and the audit log.

export interface ExpiredTrashedNote {
  id: string;
  userId: string;
}

export interface ServerStats {
  totals: {
    users: number;
    notes: number;
    trashedNotes: number;
    shares: number;
    attachments: number;
    attachmentBytes: number;
    versions: number;
  };
  /** Every account with what it holds; attachments are counted under the
   * notes' owner. */
  perUser: {
    userId: string;
    notes: number;
    attachments: number;
    attachmentBytes: number;
  }[];
}

export interface MaintenanceRepo {
  /** Counts for the admin overview, from plain aggregates. */
  stats(): Promise<ServerStats>;
  cleanupTrashedBefore(cutoffIso: string): Promise<ExpiredTrashedNote[]>;
  /**
   * Remove shares their recipients put in their own trash before the cutoff,
   * returning what was removed. The note stays with its owner and everyone
   * else; for the recipient it is gone, as a note of their own would be.
   */
  cleanupTrashedSharesBefore(cutoffIso: string): Promise<NoteShare[]>;
}

export interface AuditRecord {
  id: string;
  at: string;
  action: AuditAction;
  actorId: string | null;
  targetId: string | null;
  noteId: string | null;
  ip: string | null;
  detail: Record<string, string>;
}

export interface AuditListOptions {
  limit: number;
  /** Entries older than this id (ids are ULIDs, so they sort by time). */
  before?: string;
  /** Entries where this account is the actor or the target. */
  userId?: string;
  action?: AuditAction;
}

export interface AuditRepo {
  append(record: AuditRecord): Promise<void>;
  /** Newest first. */
  list(options: AuditListOptions): Promise<AuditRecord[]>;
  deleteBefore(at: string): Promise<number>;
}
