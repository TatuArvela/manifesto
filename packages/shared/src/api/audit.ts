import type { ShareUser } from "../note.js";

/** What the audit log records. */
export const AUDIT_ACTIONS = [
  "account.registered",
  "account.exported",
  "auth.signed_in",
  "auth.sign_in_failed",
  "auth.signed_out",
  "auth.password_changed",
  "auth.password_reset_requested",
  "auth.password_reset",
  "auth.two_factor_enabled",
  "auth.two_factor_disabled",
  "auth.passkey_added",
  "auth.passkey_removed",
  "token.created",
  "token.revoked",
  "webhook.created",
  "webhook.deleted",
  "share.created",
  "share.role_changed",
  "share.removed",
  "share.team_added",
  "share.team_role_changed",
  "share.team_removed",
  "link.created",
  "link.revoked",
  "admin.user_created",
  "admin.user_deleted",
  "admin.admin_granted",
  "admin.admin_revoked",
  "admin.email_changed",
  "admin.password_reset",
  "admin.user_exported",
  "admin.team_created",
  "admin.team_updated",
  "admin.team_deleted",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * One line of the audit log, as `GET /api/admin/audit` lists it, and
 * `GET /api/auth/me/activity` lists a user's own.
 */
export interface AuditEntry {
  id: string;
  at: string;
  action: AuditAction;
  /** Who did it; null when nobody was signed in (a failed sign-in). */
  actor: ShareUser | null;
  /** Whose account it was about, when not the actor's. */
  target: ShareUser | null;
  noteId: string | null;
  ip: string | null;
  /** A few words of detail: the method, a failure's reason, a role. */
  detail: Record<string, string>;
}

export interface AuditLogResponse {
  entries: AuditEntry[];
  /** Pass as `before` for older entries; null at the end. */
  nextBefore: string | null;
}
