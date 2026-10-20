import {
  type AdminChecksResponse,
  type AdminOverviewResponse,
  type AdminTemporaryPasswordResponse,
  type AdminTestMailResponse,
  type AdminUpdateResponse,
  type AdminUser,
  type AdminUserResponse,
  type AdminUsersResponse,
  type AuditLogResponse,
  PROXY_PROBE_ADDRESS,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { t } from "#/i18n/index.ts";
import type { MessageKey } from "#/i18n/messages/index.ts";
import { ApiError, apiJson } from "#/storage/apiRequest.ts";
import { refreshCurrentUser } from "./account/auth.ts";
import { activeView, showError, showSuccess } from "./ui.ts";

/**
 * Account administration, for the `/admin` view.
 *
 * Each action here follows the contract in `actions.ts`. It reports its own
 * failure and resolves, and its return value tells if it worked. The error text
 * of the server is English and written for a log. Thus, the code maps failures
 * to catalogue messages by status, and does not show them as they came.
 */

/** Each account on the server, or null before the first load is complete. */
export const adminUsers = signal<AdminUser[] | null>(null);

/**
 * A password that the server just gave. It shows one time and is never loaded
 * again. Thus, it is kept here only until the admin dismisses it.
 */
export interface IssuedPassword {
  username: string;
  password: string;
  /** If this action created the account, or reset its password. */
  kind: "created" | "reset";
}

export const issuedPassword = signal<IssuedPassword | null>(null);

function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  return apiJson<T>(method, `/admin${path}`, body, headers);
}

/**
 * Tell what went wrong. A 403 means that this user is not an admin now (a
 * different admin revoked it). Thus, their current view has nothing left to
 * show them.
 */
function report(err: unknown, fallback: MessageKey, conflict?: MessageKey) {
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 401) return; // signed out; the login screen tells sufficient
  if (err instanceof ApiError && err.code === "email_taken") {
    showError(t("admin.error.emailTaken"));
    return;
  }
  if (status === 403) {
    showError(t("admin.error.forbidden"));
    adminUsers.value = null;
    activeView.value = "active";
    void refreshCurrentUser();
    return;
  }
  showError(t(status === 409 && conflict ? conflict : fallback));
}

function replaceUser(user: AdminUser) {
  const users = adminUsers.value ?? [];
  const index = users.findIndex((u) => u.id === user.id);
  adminUsers.value =
    index === -1
      ? [...users, user].sort((a, b) =>
          a.username.localeCompare(b.username, undefined, {
            sensitivity: "base",
          }),
        )
      : users.map((u) => (u.id === user.id ? user : u));
}

/**
 * A release newer than the version that the server runs, when its update check
 * found one.
 */
export const availableUpdate = signal<{ latest: string; url: string } | null>(
  null,
);

/**
 * Asks the server if a newer release is available, for the account menu to
 * tell. Silent on failure: this is news, not something to act on now.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const body = await request<AdminUpdateResponse>("GET", "/update");
    availableUpdate.value = body?.update?.available
      ? { latest: body.update.latest, url: body.update.url }
      : null;
  } catch {
    availableUpdate.value = null;
  }
}

/** The overview of the server. Null on failure, which was reported. */
export async function loadAdminOverview(): Promise<AdminOverviewResponse | null> {
  try {
    return await request<AdminOverviewResponse>("GET", "/overview");
  } catch (err) {
    report(err, "overview.failed");
    return null;
  }
}

/**
 * What the setup checks read. Null on failure, which was reported. It carries
 * an invented `X-Forwarded-For`, and what the proxy in front did to it is part
 * of the answer.
 */
export async function loadSetupChecks(): Promise<AdminChecksResponse | null> {
  try {
    return await request<AdminChecksResponse>("GET", "/checks", undefined, {
      "X-Forwarded-For": PROXY_PROBE_ADDRESS,
    });
  } catch (err) {
    report(err, "checks.failed");
    return null;
  }
}

/**
 * Sends the admin a test email, and tells if it went. A 409 is an account with
 * no address to send it to.
 */
export async function sendTestMail(): Promise<boolean> {
  try {
    const body = await request<AdminTestMailResponse>("POST", "/checks/mail");
    if (body?.sent) {
      showSuccess(t("checks.mail.testSent"));
      return true;
    }
    showError(t("checks.mail.testFailed"));
    return false;
  } catch (err) {
    report(err, "checks.mail.testFailed", "checks.mail.noAddress");
    return false;
  }
}

/**
 * One page of the audit log, older than `before` when given. Null on failure,
 * which was reported.
 */
export async function loadAuditLog(
  before?: string,
): Promise<AuditLogResponse | null> {
  try {
    const query = before ? `?before=${encodeURIComponent(before)}` : "";
    return await request<AuditLogResponse>("GET", `/audit${query}`);
  } catch (err) {
    report(err, "audit.failed");
    return null;
  }
}

export async function loadAdminUsers(): Promise<boolean> {
  try {
    const body = await request<AdminUsersResponse>("GET", "/users");
    adminUsers.value = body?.users ?? [];
    return true;
  } catch (err) {
    report(err, "admin.error.loadFailed");
    return false;
  }
}

export async function createAccount(
  username: string,
  email?: string,
): Promise<boolean> {
  try {
    const body = await request<AdminTemporaryPasswordResponse>(
      "POST",
      "/users",
      { username, ...(email ? { email } : {}) },
    );
    if (!body) return false;
    replaceUser(body.user);
    issuedPassword.value = {
      username: body.user.username,
      password: body.temporaryPassword,
      kind: "created",
    };
    return true;
  } catch (err) {
    report(err, "admin.error.createFailed", "admin.error.usernameTaken");
    return false;
  }
}

export async function setAccountAdmin(
  id: string,
  isAdmin: boolean,
): Promise<boolean> {
  try {
    const body = await request<AdminUserResponse>("PUT", `/users/${id}`, {
      isAdmin,
    });
    if (body) replaceUser(body.user);
    return true;
  } catch (err) {
    report(err, "admin.error.updateFailed", "admin.error.lastAdmin");
    return false;
  }
}

/** Set or clear (`null`) the email address of an account. */
export async function setAccountEmail(
  id: string,
  email: string | null,
): Promise<boolean> {
  try {
    const body = await request<AdminUserResponse>("PUT", `/users/${id}`, {
      email,
    });
    if (body) replaceUser(body.user);
    return true;
  } catch (err) {
    report(err, "admin.error.emailFailed");
    return false;
  }
}

export async function resetAccountPassword(id: string): Promise<boolean> {
  try {
    const body = await request<AdminTemporaryPasswordResponse>(
      "POST",
      `/users/${id}/password`,
    );
    if (!body) return false;
    replaceUser(body.user);
    issuedPassword.value = {
      username: body.user.username,
      password: body.temporaryPassword,
      kind: "reset",
    };
    return true;
  } catch (err) {
    report(err, "admin.error.resetFailed");
    return false;
  }
}

export async function deleteAccount(id: string): Promise<boolean> {
  try {
    await request<null>("DELETE", `/users/${id}`);
    adminUsers.value = (adminUsers.value ?? []).filter((u) => u.id !== id);
    return true;
  } catch (err) {
    report(err, "admin.error.deleteFailed", "admin.error.lastAdmin");
    return false;
  }
}
