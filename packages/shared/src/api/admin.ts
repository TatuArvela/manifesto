import type { ShareUser } from "#/note.ts";
import type { AuthProviderName } from "./auth.ts";

/**
 * `GET /api/v1/admin/overview`: what the server contains, and the status of its
 * background jobs.
 */
export interface AdminOverviewResponse {
  version: string;
  /** Since the start of this process, in seconds. */
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
  /** Accounts by what they contain, the largest first. */
  perUser: {
    user: ShareUser;
    notes: number;
    attachments: number;
    attachmentBytes: number;
  }[];
  /**
   * What the update check found last. Null when it is off or did not run yet.
   */
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

/** `GET /api/v1/admin/update`. */
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
  /** Has a temporary password that was not replaced yet. */
  mustChangePassword: boolean;
  noteCount: number;
  createdAt: string;
  /** The most recent request of a live session. Null when there is none. */
  lastSeenAt: string | null;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

export interface AdminUserResponse {
  user: AdminUser;
}

export interface AdminCreateUserRequest {
  username: string;
  email?: string;
}

/** One or both of the two. `email: null` clears it. */
export interface AdminUpdateUserRequest {
  isAdmin?: boolean;
  email?: string | null;
}

/**
 * A new account, or a reset account, with the password that its owner uses one
 * time to sign in. The server keeps only its hash. Thus, this response is the
 * only place where you can read it.
 */
export interface AdminTemporaryPasswordResponse {
  user: AdminUser;
  temporaryPassword: string;
}

/**
 * What the admin overview sends as `X-Forwarded-For` on `GET
 * /api/v1/admin/checks`, to see what the proxy in front does with it: a
 * documentation address (RFC 5737), which no real client has.
 */
export const PROXY_PROBE_ADDRESS = "203.0.113.77";

/**
 * What occurred to the probe on its way to the server: it came as it was sent
 * (no proxy set the header), a proxy replaced it or added to it, or the header
 * arrived empty.
 */
export type ProxyFinding = "untouched" | "overwritten" | "appended" | "removed";

/**
 * `GET /api/v1/admin/checks`: the facts that the setup checks of the overview
 * read.
 */
export interface AdminChecksResponse {
  /** `APP_URL`, which the client compares with its own address. */
  appUrl: string | null;
  trustProxy: boolean;
  proxy: ProxyFinding;
  /** Scheduled backups. Null on Postgres, which has its own backups. */
  backup: {
    scheduled: boolean;
    lastFinishedAt: string | null;
    lastError: string | null;
  } | null;
  /** The status of mail since the server started. Null without `SMTP_URL`. */
  mail: {
    lastSentAt: string | null;
    lastFailedAt: string | null;
  } | null;
}

/** `POST /api/v1/admin/checks/mail`: if the test message went out. */
export interface AdminTestMailResponse {
  sent: boolean;
}
