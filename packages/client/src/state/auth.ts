import type {
  AuthMeResponse,
  AuthMethodsResponse,
  AuthProviderName,
  AuthSuccessResponse,
  ErrorResponse,
  UserLookupMode,
} from "@manifesto/shared";
import { effect, signal } from "@preact/signals";
import { resolveServerOrigin, resolveServerUrl } from "../config.js";
import type { MessageKey } from "../i18n/messages/index.js";
import { storageConnection } from "../storage/index.js";

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  email: string | null;
  isAdmin: boolean;
  /** Signs in with a password here; absent when the server did not say. */
  hasPassword?: boolean;
  /** The language the server holds for this account, for mail sent to it;
   * absent from a server that does not keep one. */
  locale?: string | null;
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

/**
 * The server, from the `manifesto-server` meta tag or the build-time value.
 * See {@link resolveServerUrl} for why a bundle gets a say at all.
 *
 * This is a `fetch` base and may be relative, including the empty string that
 * `/` resolves to. So every guard here tests `=== null` and never falsiness:
 * the empty string is a server on this page's own origin, and treating it as
 * "no server" is how a single-origin deployment used to render a login screen
 * whose every request took the open-mode branch instead of being sent.
 */
export const SERVER_URL: string | null = resolveServerUrl(
  typeof rawServer === "string" ? rawServer : undefined,
);

/** The same server spelled absolutely, for the callers that cannot use a
 * relative base. See {@link resolveServerOrigin}. */
export const SERVER_ORIGIN: string | null = resolveServerOrigin(SERVER_URL);

/** The `ws(s)://` origin both sockets dial, or null when there is none. */
export const WS_ORIGIN: string | null =
  SERVER_ORIGIN === null ? null : SERVER_ORIGIN.replace(/^http/, "ws");

export const isServerMode = SERVER_URL !== null;

/**
 * The user out of a persisted or cross-tab payload, or null. `isAdmin` and
 * `email` may be missing: a session saved before they existed is still a good
 * session, and signing everyone out on upgrade to learn what `/me` will supply
 * would be a poor trade. Missing reads as not an admin, with no address, until
 * then.
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
    email: typeof v.email === "string" ? v.email : null,
    isAdmin: v.isAdmin === true,
    ...(typeof v.hasPassword === "boolean" && { hasPassword: v.hasPassword }),
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
 * A sign-in or registration the server refused. It carries the status, not
 * just the server's `error`, because that text is English and written for a
 * log: the login screen says what went wrong in the catalogue's words.
 */
export class AuthRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: ErrorResponse["code"],
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

/**
 * The password was right but is a temporary one, and signing in has to set a
 * new one. Thrown rather than returned so `LoginScreen`'s single catch can
 * tell it apart from a failure.
 */
export class PasswordChangeRequiredError extends AuthRequestError {
  constructor(message: string) {
    super(403, message);
    this.name = "PasswordChangeRequiredError";
  }
}

/**
 * The password was right and the account has two-factor sign-in on: the same
 * request has to be sent again with a code.
 */
export class TwoFactorRequiredError extends AuthRequestError {
  constructor(message: string) {
    super(403, message, "two_factor_required");
    this.name = "TwoFactorRequiredError";
  }
}

/** Throws for a refused auth request, keeping its status. */
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
  if (code === "two_factor_required") {
    throw new TwoFactorRequiredError(message);
  }
  throw new AuthRequestError(res.status, message, code);
}

/**
 * What the login screen should say about a failed sign-in, registration or
 * first password change, by status. The server's own text never reaches the
 * screen, so every message comes from the catalogue.
 */
export function loginErrorKey(
  err: unknown,
  mode: "signIn" | "register" | "changePassword" | "twoFactor",
): MessageKey {
  if (!(err instanceof AuthRequestError)) {
    // `fetch` rejects with a TypeError when the server cannot be reached.
    return err instanceof TypeError
      ? "login.serverUnavailable"
      : "login.errorGeneric";
  }
  switch (err.status) {
    case 401:
      return mode === "twoFactor"
        ? "login.twoFactorInvalid"
        : "login.invalidCredentials";
    case 403:
      return mode === "register"
        ? "login.registrationDisabled"
        : "login.errorGeneric";
    case 409:
      return err.code === "email_taken"
        ? "login.emailTaken"
        : "login.usernameTaken";
    case 422:
      // The form checks lengths first, so on the change step this is the new
      // password matching the temporary one.
      return mode === "changePassword"
        ? "login.samePassword"
        : "login.errorGeneric";
    case 429:
      return "login.tooManyAttempts";
    default:
      return "login.errorGeneric";
  }
}

async function authRequest(
  path: string,
  body: unknown,
): Promise<AuthSuccessResponse> {
  if (SERVER_URL === null) {
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
  otp?: string,
): Promise<void> {
  const result = await authRequest("/api/auth/login", {
    username,
    password,
    ...(newPassword === undefined ? {} : { newPassword }),
    ...(otp === undefined ? {} : { otp }),
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
  if (SERVER_URL === null || !token) return "failed";
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
  if (SERVER_URL === null || !token) return;
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
  email?: string,
): Promise<void> {
  const result = await authRequest("/api/auth/register", {
    username,
    password,
    ...(email ? { email } : {}),
  });
  authToken.value = result.token;
  currentUser.value = result.user;
}

export async function logout(): Promise<void> {
  const token = authToken.value;
  authToken.value = null;
  currentUser.value = null;
  if (!token || SERVER_URL === null) return;
  try {
    await fetch(`${SERVER_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // best-effort revoke
  }
}

export type UpdateEmailResult = "ok" | "taken" | "invalid" | "failed";

/**
 * Set or clear (`null`) the signed-in user's email address. Resolves with what
 * happened, for the dialog to say in its own words.
 */
export async function updateEmail(
  email: string | null,
): Promise<UpdateEmailResult> {
  const token = authToken.value;
  if (SERVER_URL === null || !token) return "failed";
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/me`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email }),
    });
    if (res.status === 401) clearAuthLocal();
    if (res.status === 409) return "taken";
    if (res.status === 422) return "invalid";
    if (!res.ok) return "failed";
    const body = (await res.json()) as AuthMeResponse;
    if (authToken.value === token) currentUser.value = body.user;
    return "ok";
  } catch {
    return "failed";
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
 * How this server signs people in, once something has asked. The account menu reads
 * it to decide whether there is a password to change, and the admin view
 * whether accounts can be created here or belong to an identity provider.
 */
export const authProviderName = signal<AuthProviderName | null>(null);

/**
 * How the share dialog finds people on this server: suggestions as you type,
 * or only a whole username or address. `search` until the server says, which
 * is the server's own default and the friendlier guess.
 */
export const userLookupMode = signal<UserLookupMode>("search");

/** Every way in this server offers; both kinds side by side is possible. */
export const authProviders = signal<AuthProviderName[]>([]);

/** With both kinds on, whether the password form is folded behind a link. */
export const passwordFormCollapsed = signal(false);

/** Whether this server lets users register webhooks. */
export const webhooksEnabled = signal(false);

export async function fetchAuthMethods(): Promise<AuthMethodsResponse | null> {
  if (SERVER_URL === null) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/methods`);
    if (!res.ok) return null;
    const methods = (await res.json()) as AuthMethodsResponse;
    authProviderName.value = methods.provider;
    authProviders.value = methods.providers ?? [methods.provider];
    passwordFormCollapsed.value = methods.passwordForm === "collapsed";
    // A server from before sharing does not say, and has no lookup anyway.
    if (methods.userLookup === "exact" || methods.userLookup === "search") {
      userLookupMode.value = methods.userLookup;
    }
    webhooksEnabled.value = methods.webhooks === true;
    return methods;
  } catch {
    return null;
  }
}

export function buildOidcLoginUrl(): string | null {
  if (SERVER_URL === null) return null;
  return `${SERVER_URL}/api/auth/login`;
}

export const oidcLoginUrl = buildOidcLoginUrl();

/**
 * After an OIDC callback the server redirects to the client with the session
 * token in the URL fragment (`#token=...`). Picks it up, fetches the current
 * user via /api/auth/me, populates the auth signals, and clears the fragment
 * from the address bar so refreshes don't re-trigger the flow.
 */
/**
 * Asks for a reset link to be mailed. The server answers the same whether or
 * not the address has an account, so this says only whether the request got
 * there. `locale` picks the mail's language.
 */
export async function requestPasswordReset(
  email: string,
  locale: string,
): Promise<boolean> {
  if (SERVER_URL === null) return false;
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, locale }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sets a new password with a mailed link's token. */
export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<"ok" | "expired" | "failed"> {
  if (SERVER_URL === null) return "failed";
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    if (res.status === 410) return "expired";
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * A mailed reset link's token, taken from `#reset=` once and removed from the
 * address bar, so it is not left in history or shown over someone's shoulder.
 */
export function takeResetToken(): string | null {
  if (typeof window === "undefined") return null;
  const match = /^#reset=([0-9a-f]{16,200})$/.exec(window.location.hash);
  if (!match) return null;
  history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return match[1];
}

export type OidcRefusal =
  | "not_in_group"
  | "not_registered"
  | "groups_unavailable";

/**
 * Why the server turned away a single sign-on the identity provider accepted:
 * not in the group allowed to sign in, no account while registration is off,
 * or groups that could not be read. Set from the callback's `#error=`, for
 * the login screen to say.
 */
export const oidcRefusal = signal<OidcRefusal | null>(null);

export async function consumeOidcRedirect(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (SERVER_URL === null) return false;
  const hash = window.location.hash;
  const refusal =
    /^#error=(not_in_group|not_registered|groups_unavailable)$/.exec(hash);
  if (refusal) {
    oidcRefusal.value = refusal[1] as OidcRefusal;
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    return false;
  }
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

export type { AuthProviderName, UserLookupMode };
