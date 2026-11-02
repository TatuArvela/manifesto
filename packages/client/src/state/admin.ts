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
import type { ConfirmationRefusal } from "./account/passwordConfirmation.ts";
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

/**
 * What a change to an account gave: it was done, it failed (and was reported),
 * or the server wants the confirmation of the admin first. The form that asked
 * shows the refusal next to its password field (`ConfirmationError`).
 */
export type AdminChange = "done" | "failed" | ConfirmationRefusal;

/**
 * The refusal of the confirmation (`auth/confirmation.ts` on the server), or
 * null for a different failure. A 403 without one of these codes means that this
 * user is not an admin now, which `report` handles.
 */
function refusalOf(err: unknown): ConfirmationRefusal | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 429) return "locked";
  if (err.status !== 403) return null;
  if (err.code === "confirmation_required") return "password-missing";
  if (err.code === "password_incorrect") return "password-wrong";
  if (err.code === "reauthentication_required") return "sign-in-again";
  return null;
}

/** The refusal to show, or `failed` after the failure was reported. */
function refusedOrReported(
  err: unknown,
  fallback: MessageKey,
  conflict?: MessageKey,
): AdminChange {
  const refusal = refusalOf(err);
  if (refusal) return refusal;
  report(err, fallback, conflict);
  return "failed";
}

/** The confirmation as the body carries it. An admin without a password sends none. */
function confirmation(password: string): { password?: string } {
  return password ? { password } : {};
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
  email: string | undefined,
  password: string,
): Promise<AdminChange> {
  try {
    const body = await request<AdminTemporaryPasswordResponse>(
      "POST",
      "/users",
      { username, ...(email ? { email } : {}), ...confirmation(password) },
    );
    if (!body) return "failed";
    replaceUser(body.user);
    issuedPassword.value = {
      username: body.user.username,
      password: body.temporaryPassword,
      kind: "created",
    };
    return "done";
  } catch (err) {
    return refusedOrReported(
      err,
      "admin.error.createFailed",
      "admin.error.usernameTaken",
    );
  }
}

export async function setAccountAdmin(
  id: string,
  isAdmin: boolean,
  password: string,
): Promise<AdminChange> {
  try {
    const body = await request<AdminUserResponse>("PUT", `/users/${id}`, {
      isAdmin,
      ...confirmation(password),
    });
    if (body) replaceUser(body.user);
    return "done";
  } catch (err) {
    return refusedOrReported(
      err,
      "admin.error.updateFailed",
      "admin.error.lastAdmin",
    );
  }
}

/** Set or clear (`null`) the email address of an account. */
export async function setAccountEmail(
  id: string,
  email: string | null,
  password: string,
): Promise<AdminChange> {
  try {
    const body = await request<AdminUserResponse>("PUT", `/users/${id}`, {
      email,
      ...confirmation(password),
    });
    if (body) replaceUser(body.user);
    return "done";
  } catch (err) {
    return refusedOrReported(err, "admin.error.emailFailed");
  }
}

export async function resetAccountPassword(
  id: string,
  password: string,
): Promise<AdminChange> {
  try {
    const body = await request<AdminTemporaryPasswordResponse>(
      "POST",
      `/users/${id}/password`,
      confirmation(password),
    );
    if (!body) return "failed";
    replaceUser(body.user);
    issuedPassword.value = {
      username: body.user.username,
      password: body.temporaryPassword,
      kind: "reset",
    };
    return "done";
  } catch (err) {
    return refusedOrReported(err, "admin.error.resetFailed");
  }
}

export async function deleteAccount(
  id: string,
  password: string,
): Promise<AdminChange> {
  try {
    await request<null>("DELETE", `/users/${id}`, confirmation(password));
    adminUsers.value = (adminUsers.value ?? []).filter((u) => u.id !== id);
    return "done";
  } catch (err) {
    return refusedOrReported(
      err,
      "admin.error.deleteFailed",
      "admin.error.lastAdmin",
    );
  }
}
