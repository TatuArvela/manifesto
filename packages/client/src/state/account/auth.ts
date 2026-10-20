import type {
  AuthMeResponse,
  AuthProviderName,
  AuthSuccessResponse,
  CapabilitiesResponse,
  ErrorResponse,
  PasskeyAuthenticationResponse,
  PasskeyRequestOptions,
  PasskeySignInOptionsResponse,
  TwoFactorRequiredResponse,
  UserLookupMode,
} from "@manifesto/shared";
import { effect, signal } from "@preact/signals";
import { resolveServerOrigin, resolveServerUrl } from "#/config.ts";
import type { MessageKey } from "#/i18n/messages/index.ts";
import { defaultPrefsOf, serverDefaultPrefs } from "#/state/serverDefaults.ts";
import { adoptServerFeatures } from "#/state/serverFeatures.ts";
import { storageConnection } from "#/storage/index.ts";
import { getPasskey } from "#/utils/webauthn.ts";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./passwordConfirmation.ts";

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  email: string | null;
  isAdmin: boolean;
  /** Signs in with a password here. Absent when the server did not tell. */
  hasPassword?: boolean;
  /**
   * The language that the server keeps for this account, for the mail that it
   * sends to it. Absent from a server that does not keep one.
   */
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
 * The server, from the `manifesto-server` meta tag or the build-time value. See
 * {@link resolveServerUrl} for why a bundle can set it.
 *
 * This is a `fetch` base, and can be relative, also the empty string to which
 * `/` resolves. Thus, each guard here tests `=== null`, and never falsiness.
 * The empty string is a server on the own origin of this page. If the code
 * treated it as "no server", each request of a single-origin deployment would
 * go down the open-mode branch.
 */
export const SERVER_URL: string | null = resolveServerUrl(
  typeof rawServer === "string" ? rawServer : undefined,
);

/**
 * The same server as an absolute address, for the callers that cannot use a
 * relative base. See {@link resolveServerOrigin}.
 */
export const SERVER_ORIGIN: string | null = resolveServerOrigin(SERVER_URL);

/**
 * The `ws(s)://` origin to which both sockets connect, or null when there is
 * none.
 */
export const WS_ORIGIN: string | null =
  SERVER_ORIGIN === null ? null : SERVER_ORIGIN.replace(/^http/, "ws");

export const isServerMode = SERVER_URL !== null;

/**
 * The user from a persisted or cross-tab payload, or null. `isAdmin` and
 * `email` can be missing. A session saved before they existed is still a good
 * session. A sign-out of all persons on upgrade, only to learn what `/me` will
 * give, would cost too much. Until then, a missing value reads as not an admin,
 * with no address.
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
    ...((typeof v.locale === "string" || v.locale === null) && {
      locale: v.locale,
    }),
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
    // Ignore corrupt payloads.
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
    try {
      if (token && user) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage refused: signed in for this tab, until it closes.
    }
  }, 50);
});

// Cross-tab sync. When a different tab logs in, logs out, or its session
// becomes invalid, make the same change here. Thus, the user sees the same view
// across tabs. Without this, Tab B continues to send requests with a revoked
// token until the next 401 round trip.
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
      // Ignore corrupt payloads from other tabs.
    }
  });
}

/**
 * A sign-in or registration that the server refused. It carries the status, not
 * only the `error` of the server, because that text is English and written for
 * a log. The login screen tells what went wrong in the words of the catalogue.
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
 * The password was correct, but it is a temporary password, and the sign-in
 * must set a new one. Thrown, not returned. Thus, the single catch of
 * `LoginScreen` can tell it from a failure.
 */
export class PasswordChangeRequiredError extends AuthRequestError {
  constructor(message: string) {
    super(403, message);
    this.name = "PasswordChangeRequiredError";
  }
}

/**
 * The password was correct, and the account has two-factor sign-in on. The same
 * request must go again with a code, or with the answer of a passkey to
 * `passkey`, the challenge that this sign-in got (null when the account has no
 * passkey for this address). A server from before passkeys tells neither, and
 * has only codes.
 */
export class TwoFactorRequiredError extends AuthRequestError {
  constructor(
    message: string,
    public authenticator = true,
    public passkey: PasskeyRequestOptions | null = null,
  ) {
    super(403, message, "two_factor_required");
    this.name = "TwoFactorRequiredError";
  }
}

/** Throws for a refused auth request, and keeps its status. */
async function throwForResponse(res: Response): Promise<never> {
  let message = `Request failed (${res.status})`;
  let code: ErrorResponse["code"];
  let twoFactor: TwoFactorRequiredResponse["twoFactor"];
  try {
    const data = (await res.json()) as Partial<TwoFactorRequiredResponse>;
    if (typeof data.error === "string") message = data.error;
    code = data.code;
    twoFactor = data.twoFactor;
  } catch {
    // A body that is not JSON. Keep the default.
  }
  if (code === "password_change_required") {
    throw new PasswordChangeRequiredError(message);
  }
  if (code === "two_factor_required") {
    throw new TwoFactorRequiredError(
      message,
      twoFactor?.authenticator ?? true,
      twoFactor?.passkey ?? null,
    );
  }
  throw new AuthRequestError(res.status, message, code);
}

/**
 * What the login screen must say about a failed sign-in, registration or first
 * password change, by status. The own text of the server never reaches the
 * screen. Thus, each message comes from the catalogue.
 */
export function loginErrorKey(
  err: unknown,
  mode: "signIn" | "register" | "changePassword" | "twoFactor",
): MessageKey {
  if (!(err instanceof AuthRequestError)) {
    // `fetch` rejects with a TypeError when it cannot reach the server.
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
      // The form checks lengths first. Thus, on the change step, this is a new
      // password that is the same as the temporary password.
      return mode === "changePassword"
        ? "login.samePassword"
        : "login.errorGeneric";
    case 429:
      return "login.tooManyAttempts";
    default:
      return "login.errorGeneric";
  }
}

/**
 * A request with no session of this tab behind it, as the sign-in screens make.
 * `body` goes as JSON in a POST, and `bearer` names a session that the server
 * just gave. `fetch` is permitted here and in `storage/`. Thus, the modules
 * next to this one (`mailedLinks.ts`, `oidcSignIn.ts`) send through it. Rejects
 * as `fetch` does, and when no server is configured.
 */
export async function requestWithoutSession(
  path: string,
  { body, bearer }: { body?: unknown; bearer?: string } = {},
): Promise<Response> {
  if (SERVER_URL === null) throw new Error("Server is not configured");
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return fetch(`${SERVER_URL}${path}`, {
    ...(body !== undefined && { method: "POST", body: JSON.stringify(body) }),
    headers,
  });
}

/**
 * Signs in or registers. Throws what the server refused as an
 * `AuthRequestError` (or one of its kinds).
 */
export async function authRequest(
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
 * Sign in. The code sends `newPassword` only to complete a sign-in with a
 * temporary password, after this threw `PasswordChangeRequiredError` one time.
 */
export async function login(
  username: string,
  password: string,
  newPassword?: string,
  otp?: string,
  passkey?: PasskeyAuthenticationResponse,
): Promise<void> {
  const result = await authRequest("/api/v1/auth/login", {
    username,
    password,
    ...(newPassword === undefined ? {} : { newPassword }),
    ...(otp === undefined ? {} : { otp }),
    ...(passkey === undefined ? {} : { passkey }),
  });
  authToken.value = result.token;
  currentUser.value = result.user;
}

/**
 * Signs in with only a passkey: a challenge from the server, the prompt of the
 * browser, and the answer back. Resolves with what occurred. `unknown` is a
 * passkey that this server does not know or would not accept.
 */
export async function signInWithPasskey(): Promise<
  "ok" | "cancelled" | "unknown" | "failed"
> {
  if (SERVER_URL === null) return "failed";
  try {
    const started = await fetch(`${SERVER_URL}/api/v1/auth/passkey/options`, {
      method: "POST",
    });
    if (!started.ok) return "failed";
    const { options } = (await started.json()) as PasskeySignInOptionsResponse;
    const answer = await getPasskey(options);
    if (answer === "cancelled") return "cancelled";
    if (typeof answer === "string") return "failed";
    const res = await fetch(`${SERVER_URL}/api/v1/auth/passkey/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: answer }),
    });
    if (res.status === 401) return "unknown";
    if (!res.ok) return "failed";
    const result = (await res.json()) as AuthSuccessResponse;
    authToken.value = result.token;
    currentUser.value = result.user;
    return "ok";
  } catch {
    return "failed";
  }
}

export type ChangePasswordResult =
  | "ok"
  | "wrong-password"
  | "same-password"
  | "failed";

/**
 * Change the password of the signed-in user. Each other session ends, and this
 * session continues. Resolves with what occurred, so that the form can tell it
 * in its own words, not in those of the server.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const token = authToken.value;
  if (SERVER_URL === null || !token) return "failed";
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/auth/password`, {
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
    // The form already checked the length. Thus, the only remaining refusal is
    // a new password that is the same as the current password.
    if (res.status === 422) return "same-password";
    return "failed";
  } catch {
    return "failed";
  }
}

/**
 * Read the current user again from the server. The value kept at sign-in
 * becomes stale when an admin gives or removes admin rights. Thus, the app asks
 * again on start. Resolves in both cases. A failure keeps the persisted user,
 * and a 401 signs out, as in all other places.
 */
export async function refreshCurrentUser(): Promise<void> {
  const token = authToken.value;
  if (SERVER_URL === null || !token) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      clearAuthLocal();
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as AuthMeResponse;
    // A sign-out or a different account in the meantime makes this answer
    // stale.
    if (authToken.value === token) currentUser.value = body.user;
  } catch {
    // Offline: keep what we have.
  }
}

export async function register(
  username: string,
  password: string,
  email?: string,
): Promise<void> {
  const result = await authRequest("/api/v1/auth/register", {
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
    await fetch(`${SERVER_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Try to revoke. A failure is acceptable.
  }
}

export type UpdateEmailResult =
  | "ok"
  | "taken"
  | "invalid"
  | "failed"
  | ConfirmationRefusal;

/**
 * Set or clear (`null`) the email address of the signed-in user. Resolves with
 * what occurred, so that the dialog can tell it in its own words.
 */
export async function updateEmail(
  email: string | null,
  password: string,
): Promise<UpdateEmailResult> {
  const token = authToken.value;
  if (SERVER_URL === null || !token) return "failed";
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/auth/me`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email, ...(password && { password }) }),
    });
    if (res.status === 401) clearAuthLocal();
    if (res.status === 409) return "taken";
    const refusal = await confirmationRefusal(res);
    if (refusal) return refusal;
    if (res.status === 422) return "invalid";
    if (!res.ok) return "failed";
    const body = (await res.json()) as AuthMeResponse;
    if (authToken.value === token) currentUser.value = body.user;
    return "ok";
  } catch {
    return "failed";
  }
}

export type DeleteAccountResult =
  | "ok"
  | "last-admin"
  | "failed"
  | ConfirmationRefusal;

/**
 * Ask the server to delete the signed-in account. Only the request.
 * `deleteOwnAccount` (`signOut.ts`) does what the device does after it.
 */
export async function requestAccountDeletion(
  password: string,
): Promise<DeleteAccountResult> {
  const token = authToken.value;
  if (SERVER_URL === null || !token) return "failed";
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/auth/me`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(password ? { password } : {}),
    });
    if (res.status === 401) clearAuthLocal();
    if (res.status === 409) return "last-admin";
    const refusal = await confirmationRefusal(res);
    if (refusal) return refusal;
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/** Drop the local auth state, and do not contact the server (used on 401). */
export function clearAuthLocal(): void {
  authToken.value = null;
  currentUser.value = null;
}

// The session decides to which backend a note goes. Thus, this module tells the
// storage layer. The storage layer does not read the token from here.
effect(() => {
  storageConnection.value = {
    serverUrl: SERVER_URL,
    token: authToken.value,
    onUnauthorized: clearAuthLocal,
  };
});

/**
 * How this server signs people in, after some code asked. The account menu
 * reads it to decide if there is a password to change. The admin view reads it
 * to decide if accounts can be created here or belong to an identity provider.
 */
export const authProviderName = signal<AuthProviderName | null>(null);

/**
 * How the share dialog finds people on this server: suggestions while you type,
 * or only a full username or address. `exact` until the server tells. That is
 * the own default of the server, and it shows the address of nobody.
 */
export const userLookupMode = signal<UserLookupMode>("exact");

/** Each way in that this server offers. Both kinds together are possible. */
export const authProviders = signal<AuthProviderName[]>([]);

/** With both kinds on, if the password form is behind a link. */
export const passwordFormCollapsed = signal(false);

/**
 * What the server offers, read when some code needs it (the sign-in screen, the
 * admin view, the start of the app). The signals that the remaining client
 * reads are set from it. The features that are on go to `serverFeatures`, and
 * the default preferences of the host to `serverDefaultPrefs`. Null when the
 * client cannot reach the server.
 */
export async function fetchCapabilities(): Promise<CapabilitiesResponse | null> {
  if (SERVER_URL === null) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/capabilities`);
    if (!res.ok) return null;
    const capabilities = (await res.json()) as CapabilitiesResponse;
    const { auth, features } = capabilities;
    authProviderName.value = auth.providers.includes("oidc") ? "oidc" : "local";
    authProviders.value = auth.providers;
    passwordFormCollapsed.value = auth.passwordForm === "collapsed";
    userLookupMode.value = features.userLookup;
    adoptServerFeatures(features);
    serverDefaultPrefs.value = {
      prefs: defaultPrefsOf(capabilities),
      signedIn: authToken.peek() !== null,
    };
    return capabilities;
  } catch {
    return null;
  }
}

/** The result of a step of the sign-in with the recovery key. */
export type RecoveryAnswer<T> =
  | { kind: "ok"; body: T }
  | { kind: "wrong" | "throttled" | "used" | "failed" };

/**
 * One of the two steps of a sign-in with the recovery key and the username
 * (`/api/v1/auth/recovery`, `/api/v1/auth/recovery/complete`), with nobody
 * signed in. `accountKeys.ts` does the work with the keys. The requests are
 * here, with the other requests without a session. Never rejects.
 */
export async function recoveryRequest<T>(
  step: "open" | "complete",
  body: unknown,
): Promise<RecoveryAnswer<T>> {
  if (SERVER_URL === null) return { kind: "failed" };
  const path = step === "open" ? "/recovery" : "/recovery/complete";
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { kind: "wrong" };
    if (res.status === 429) return { kind: "throttled" };
    if (res.status === 409) return { kind: "used" };
    if (!res.ok) return { kind: "failed" };
    return { kind: "ok", body: (await res.json()) as T };
  } catch {
    return { kind: "failed" };
  }
}

/** Starts a session that the server just gave. */
export function adoptSession(session: AuthSuccessResponse): void {
  authToken.value = session.token;
  currentUser.value = session.user;
}

export type { AuthProviderName, UserLookupMode };
