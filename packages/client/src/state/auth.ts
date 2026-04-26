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

interface AuthSuccess {
  token: string;
  user: CurrentUser;
}

async function authRequest(path: string, body: unknown): Promise<AuthSuccess> {
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
  return (await res.json()) as AuthSuccess;
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
