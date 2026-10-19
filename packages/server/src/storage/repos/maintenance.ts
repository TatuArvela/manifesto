import type { AuditAction } from "@manifesto/shared";
import type { NoteShare } from "./sharing.ts";

// The own housekeeping of the server: cleanup, stats and the audit log.

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
  /**
   * Each account with what it contains. Attachments count under the owner of
   * the notes.
   */
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
   * Remove the shares that their recipients put in their own trash before the
   * cutoff, and return what was removed. The note stays with its owner and all
   * other persons. For the recipient it is gone, as their own note would be.
   */
  cleanupTrashedSharesBefore(cutoffIso: string): Promise<NoteShare[]>;
  /**
   * Gives each value of one column to `rewrite`, and stores the answer. It does
   * not change the rows for which the answer is null. This is to move what is
   * under the server key to a different key (`moveToCurrentKey`). The table,
   * its primary key and the column are names from `AT_REST_COLUMNS`, never
   * input from a caller. Returns the number of rows that it wrote again.
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
  /** Entries older than this id (ids are ULIDs. Thus, they sort by time). */
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
