import type {
  AuthMeResponse,
  AuthMethodsResponse,
  AuthProviderName,
  AuthSuccessResponse,
  ErrorResponse,
} from "@manifesto/shared";
import { effect, signal } from "@preact/signals";
import { storageConnection } from "../storage/index.js";

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  isAdmin: boolean;
}

interface PersistedAuth {
  token: string;
  user: CurrentUser;
}

const STORAGE_KEY = "manifesto:auth";

const rawServer =
  typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_MANIFESTO_SERVER
    : undefined;

export const SERVER_URL: string | null =
  typeof rawServer === "string" && rawServer.trim().length > 0
    ? rawServer.replace(/\/$/, "")
    : null;

export const isServerMode = SERVER_URL !== null;

/**
 * The user out of a persisted or cross-tab payload, or null. `isAdmin` may be
 * missing: a session saved before the flag existed is still a good session,
 * and signing everyone out on upgrade to learn a flag `/me` will supply would
 * be a poor trade. Missing reads as not an admin until then.
 */
function toCurrentUser(value: unknown): CurrentUser | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    typeof v.username !== "string" ||
    typeof v.displayName !== "string" ||
    typeof v.avatarColor !== "string"
  ) {
    return null;
  }
  return {
    id: v.id,
    username: v.username,
    displayName: v.displayName,
    avatarColor: v.avatarColor,
    isAdmin: v.isAdmin === true,
  };
}

function loadPersisted(): PersistedAuth | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const user = toCurrentUser(parsed?.user);
    if (typeof parsed?.token === "string" && user) {
      return { token: parsed.token, user };
    }
  } catch {
    // ignore corrupt payloads
  }
  return null;
}

const initial = loadPersisted();

export const authToken = signal<string | null>(initial?.token ?? null);
export const currentUser = signal<CurrentUser | null>(initial?.user ?? null);

let saveTimer: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  const token = authToken.value;
  const user = currentUser.value;
  if (typeof localStorage === "undefined") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (token && user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, 50);
});

// Cross-tab sync: when another tab logs in, logs out, or has its session
// invalidated, mirror that change here so the user sees a consistent view
// across tabs. Without this, Tab B keeps issuing requests with a revoked
// token until the next 401 round-trip.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    if (!event.newValue) {
      authToken.value = null;
      currentUser.value = null;
      return;
    }
    try {
      const parsed = JSON.parse(event.newValue);
      const user = toCurrentUser(parsed?.user);
      if (typeof parsed?.token === "string" && user) {
        authToken.value = parsed.token;
        currentUser.value = user;
      }
    } catch {
      // ignore corrupt payloads from other tabs
    }
  });
}

/**
 * The password was right but is a temporary one, and signing in has to set a
 * new one. Thrown rather than returned so `LoginScreen`'s single catch can
 * tell it apart from a failure.
 */
export class PasswordChangeRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordChangeRequiredError";
  }
}

/** Throws with the server's message, or the password-change error it names. */
async function throwForResponse(res: Response): Promise<never> {
  let message = `Request failed (${res.status})`;
  let code: ErrorResponse["code"];
  try {
    const data = (await res.json()) as Partial<ErrorResponse>;
    if (typeof data.error === "string") message = data.error;
    code = data.code;
  } catch {
    // non-JSON body, leave default
  }
  if (code === "password_change_required") {
    throw new PasswordChangeRequiredError(message);
  }
  throw new Error(message);
}

async function authRequest(
  path: string,
  body: unknown,
): Promise<AuthSuccessResponse> {
  if (!SERVER_URL) {
    throw new Error("Server is not configured");
  }
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as AuthSuccessResponse;
}

/**
 * Sign in. `newPassword` is sent only to finish signing in with a temporary
 * password, after this has thrown `PasswordChangeRequiredError` once.
 */
export async function login(
  username: string,
  password: string,
  newPassword?: string,
): Promise<void> {
  const result = await authRequest("/api/auth/login", {
    username,
    password,
    ...(newPassword === undefined ? {} : { newPassword }),
  });
  authToken.value = result.token;
  currentUser.value = result.user;
}

export type ChangePasswordResult =
  | "ok"
  | "wrong-password"
  | "same-password"
  | "failed";

/**
 * Change the signed-in user's password. Every other session ends; this one
 * carries on. Resolves with what happened, for the form to say in its own
 * words rather than the server's.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const token = authToken.value;
  if (!SERVER_URL || !token) return "failed";
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.ok) return "ok";
    if (res.status === 401) clearAuthLocal();
    if (res.status === 403) return "wrong-password";
    // The form has already checked the length, so what is left to refuse is
    // a new password that is the current one.
    if (res.status === 422) return "same-password";
    return "failed";
  } catch {
    return "failed";
  }
}

/**
 * Re-read the current user from the server. What was persisted at sign-in
 * goes stale when an admin grants or revokes admin, so the app asks again on
 * start. Resolves either way: a failure leaves the persisted user in place, and
 * a 401 signs out as it would anywhere else.
 */
export async function refreshCurrentUser(): Promise<void> {
  const token = authToken.value;
  if (!SERVER_URL || !token) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      clearAuthLocal();
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as AuthMeResponse;
    // A sign-out or another account in the meantime makes this answer stale.
    if (authToken.value === token) currentUser.value = body.user;
  } catch {
    // offline: keep what we have
  }
}

export async function register(
  username: string,
  password: string,
): Promise<void> {
  const result = await authRequest("/api/auth/register", {
    username,
    password,
  });
  authToken.value = result.token;
  currentUser.value = result.user;
}

export async function logout(): Promise<void> {
  const token = authToken.value;
  authToken.value = null;
  currentUser.value = null;
  if (!token || !SERVER_URL) return;
  try {
    await fetch(`${SERVER_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // best-effort revoke
  }
}

/** Drop local auth state without contacting the server (used on 401). */
export function clearAuthLocal(): void {
  authToken.value = null;
  currentUser.value = null;
}

// Which backend a note goes to follows the session, so this module tells the
// storage layer rather than the storage layer reaching in here for the token.
effect(() => {
  storageConnection.value = {
    serverUrl: SERVER_URL,
    token: authToken.value,
    onUnauthorized: clearAuthLocal,
  };
});

/**
 * How this server signs people in, once something has asked. Settings reads
 * it to decide whether there is a password to change, and the admin view
 * whether accounts can be created here or belong to an identity provider.
 */
export const authProviderName = signal<AuthProviderName | null>(null);

export async function fetchAuthMethods(): Promise<AuthMethodsResponse | null> {
  if (!SERVER_URL) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/methods`);
    if (!res.ok) return null;
    const methods = (await res.json()) as AuthMethodsResponse;
    authProviderName.value = methods.provider;
    return methods;
  } catch {
    return null;
  }
}

export function buildOidcLoginUrl(): string | null {
  if (!SERVER_URL) return null;
  return `${SERVER_URL}/api/auth/login`;
}

export const oidcLoginUrl = buildOidcLoginUrl();

/**
 * After an OIDC callback the server redirects to the client with the session
 * token in the URL fragment (`#token=...`). Picks it up, fetches the current
 * user via /api/auth/me, populates the auth signals, and clears the fragment
 * from the address bar so refreshes don't re-trigger the flow.
 */
export async function consumeOidcRedirect(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!SERVER_URL) return false;
  const hash = window.location.hash;
  if (!hash?.includes("token=")) return false;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token");
  if (!token) return false;

  // Wipe the hash before any await so a slow /me round-trip doesn't leave the
  // token sitting in the address bar.
  history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );

  try {
    const res = await fetch(`${SERVER_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as AuthMeResponse;
    authToken.value = token;
    currentUser.value = body.user;
    return true;
  } catch {
    return false;
  }
}

export type { AuthProviderName };
