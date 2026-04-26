import type {
  AuthMeResponse,
  AuthMethodsResponse,
  AuthProviderName,
  AuthSuccessResponse,
} from "@manifesto/shared";
import { effect, signal } from "@preact/signals";

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
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

function isCurrentUser(value: unknown): value is CurrentUser {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.username === "string" &&
    typeof v.displayName === "string" &&
    typeof v.avatarColor === "string"
  );
}

function loadPersisted(): PersistedAuth | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.token === "string" &&
      isCurrentUser(parsed.user)
    ) {
      return { token: parsed.token, user: parsed.user };
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
      if (
        parsed &&
        typeof parsed.token === "string" &&
        isCurrentUser(parsed.user)
      ) {
        authToken.value = parsed.token;
        currentUser.value = parsed.user;
      }
    } catch {
      // ignore corrupt payloads from other tabs
    }
  });
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
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === "string") message = data.error;
    } catch {
      // non-JSON body, leave default
    }
    throw new Error(message);
  }
  return (await res.json()) as AuthSuccessResponse;
}

export async function login(username: string, password: string): Promise<void> {
  const result = await authRequest("/api/auth/login", { username, password });
  authToken.value = result.token;
  currentUser.value = result.user;
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

export async function fetchAuthMethods(): Promise<AuthMethodsResponse | null> {
  if (!SERVER_URL) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/methods`);
    if (!res.ok) return null;
    return (await res.json()) as AuthMethodsResponse;
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
  if (!hash || !hash.includes("token=")) return false;
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
