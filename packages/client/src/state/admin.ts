import type {
  AdminTemporaryPasswordResponse,
  AdminUser,
  AdminUserResponse,
  AdminUsersResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { t } from "../i18n/index.js";
import type { MessageKey } from "../i18n/messages/index.js";
import { storageConnection } from "../storage/index.js";
import { refreshCurrentUser } from "./auth.js";
import { activeView, showError } from "./ui.js";

/**
 * Account administration, for the `/admin` view.
 *
 * Every action here follows the contract in `actions.ts`: it reports its own
 * failure and resolves, saying whether it worked in its return value. The
 * server's error text is English and written for a log, so failures are
 * mapped to catalogue messages by status instead of being shown as they came.
 */

/** Every account on the server, or null before the first load finishes. */
export const adminUsers = signal<AdminUser[] | null>(null);

/** A password the server has just issued. It is shown once and never fetched
 * again, so it lives here only until the admin dismisses it. */
export interface IssuedPassword {
  username: string;
  password: string;
  /** Whether the account was created by this action or had its password reset. */
  kind: "created" | "reset";
}

export const issuedPassword = signal<IssuedPassword | null>(null);

class AdminRequestError extends Error {
  constructor(public status: number) {
    super(`Admin request failed (${status})`);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const { serverUrl, token, onUnauthorized } = storageConnection.value;
  if (!serverUrl || !token) throw new AdminRequestError(401);
  const res = await fetch(`${serverUrl}/api/admin${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new AdminRequestError(res.status);
  }
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

/**
 * Say what went wrong. A 403 means this user is no longer an admin (another
 * admin revoked it), so the view they are on has nothing left to show them.
 */
function report(err: unknown, fallback: MessageKey, conflict?: MessageKey) {
  const status = err instanceof AdminRequestError ? err.status : 0;
  if (status === 401) return; // signed out; the login screen says enough
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

export async function createAccount(username: string): Promise<boolean> {
  try {
    const body = await request<AdminTemporaryPasswordResponse>(
      "POST",
      "/users",
      { username },
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
