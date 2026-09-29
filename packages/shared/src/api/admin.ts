import type { ShareUser } from "../note.js";
import type { AuthProviderName } from "./auth.js";

/** `GET /api/admin/overview`: what the server holds, and how its
 * background jobs are doing. */
export interface AdminOverviewResponse {
  version: string;
  /** Since this process started, in seconds. */
  uptimeSeconds: number;
  totals: {
    users: number;
    notes: number;
    trashedNotes: number;
    shares: number;
    attachments: number;
    attachmentBytes: number;
    versions: number;
  };
  /** Accounts by what they hold, the most first. */
  perUser: {
    user: ShareUser;
    notes: number;
    attachments: number;
    attachmentBytes: number;
  }[];
  /** What the update check last found; null with it off or not yet run. */
  update: {
    latest: string;
    url: string;
    checkedAt: string;
    available: boolean;
  } | null;
  jobs: {
    name: string;
    intervalMs: number;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastDurationMs: number | null;
    lastError: string | null;
    running: boolean;
  }[];
}

/** `GET /api/admin/update`. */
export interface AdminUpdateResponse {
  version: string;
  update: AdminOverviewResponse["update"];
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  email: string | null;
  isAdmin: boolean;
  /** How the account signs in: a password here, or an identity provider. */
  provider: AuthProviderName;
  /** Holds a temporary password that has not been replaced yet. */
  mustChangePassword: boolean;
  noteCount: number;
  createdAt: string;
  /** The most recent request of any live session; null when there is none. */
  lastSeenAt: string | null;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  /** Whether the server lets an admin download an account's notes
   * (`ADMIN_EXPORT`). */
  adminExport: boolean;
}

export interface AdminUserResponse {
  user: AdminUser;
}

export interface AdminCreateUserRequest {
  username: string;
  email?: string;
}

/** At least one of the two. `email: null` clears it. */
export interface AdminUpdateUserRequest {
  isAdmin?: boolean;
  email?: string | null;
}

/**
 * A new account, or a reset one, with the password its owner signs in with
 * once. The server keeps only its hash, so this response is the one place it
 * can be read.
 */
export interface AdminTemporaryPasswordResponse {
  user: AdminUser;
  temporaryPassword: string;
}

/**
 * What the admin overview sends as `X-Forwarded-For` on `GET
 * /api/admin/checks`, to see what the proxy in front does with it: a
 * documentation address (RFC 5737), which no real client has.
 */
export const PROXY_PROBE_ADDRESS = "203.0.113.77";

/**
 * What became of the probe on its way to the server: it came as it was sent
 * (no proxy set the header), a proxy replaced it or added to it, or the
 * header arrived empty.
 */
export type ProxyFinding = "untouched" | "overwritten" | "appended" | "removed";

/** `GET /api/admin/checks`: the facts the overview's setup checks read. */
export interface AdminChecksResponse {
  /** `APP_URL`, for the client to compare with the address it is on. */
  appUrl: string | null;
  trustProxy: boolean;
  proxy: ProxyFinding;
  /** Scheduled backups; null on Postgres, whose backups are its own. */
  backup: {
    scheduled: boolean;
    lastFinishedAt: string | null;
    lastError: string | null;
  } | null;
  /** How mail has gone since the server started; null without `SMTP_URL`. */
  mail: {
    lastSentAt: string | null;
    lastFailedAt: string | null;
  } | null;
}

/** `POST /api/admin/checks/mail`: whether the test message went. */
export interface AdminTestMailResponse {
  sent: boolean;
}
