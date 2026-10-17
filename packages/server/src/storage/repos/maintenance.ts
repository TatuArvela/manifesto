import type { AuditAction } from "@manifesto/shared";
import type { NoteShare } from "./sharing.ts";

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
  /**
   * Passes every value of one column to `rewrite` and stores what it
   * answers, leaving alone the rows it answers null for. For moving what is
   * under the server key to another (`moveToCurrentKey`); the table, its
   * primary key and the column are names from `AT_REST_COLUMNS`, never a
   * caller's input. Returns how many rows were rewritten.
   */
  rewriteColumn(
    table: string,
    keys: readonly string[],
    column: string,
    rewrite: (stored: string) => string | null,
  ): Promise<number>;
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
  before?: string | undefined;
  /** Entries where this account is the actor or the target. */
  userId?: string | undefined;
  action?: AuditAction | undefined;
}

export interface AuditRepo {
  append(record: AuditRecord): Promise<void>;
  /** Newest first. */
  list(options: AuditListOptions): Promise<AuditRecord[]>;
  deleteBefore(at: string): Promise<number>;
}
