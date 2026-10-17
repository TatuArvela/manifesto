import type { AuthMeResponse } from "@manifesto/shared";
import { signal } from "@preact/signals";
import { adoptSession, requestWithoutSession, SERVER_URL } from "./auth.ts";
import { markOidcFlow, takeOidcFlow } from "./oidcFlow.ts";

// Signing in through the server's identity provider: the addresses that
// start it, and taking up the session it comes back with.

export function buildOidcLoginUrl(): string | null {
  if (SERVER_URL === null) return null;
  return `${SERVER_URL}/api/auth/login`;
}

export const oidcLoginUrl = buildOidcLoginUrl();

/** Signs in through the identity provider again, which asks for real rather
 * than reusing its own session: what an account without a password is sent to
 * when an action needs a recent sign-in. */
export const oidcReauthUrl =
  oidcLoginUrl === null ? null : `${oidcLoginUrl}?reauth=1`;

/**
 * What a link to either address above runs as it is followed: the session
 * that comes back is taken only in a tab that left this mark.
 */
export const beginOidcSignIn = (): void => markOidcFlow();

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

/**
 * After an OIDC callback the server redirects to the client with the session
 * token in the URL fragment (`#token=...`). Picks it up, fetches the current
 * user via /api/auth/me, populates the auth signals, and clears the fragment
 * from the address bar so refreshes don't re-trigger the flow.
 */
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

  // Only a sign-in this tab sent the browser to: a `#token=` in a link
  // someone was handed is the sender's session, not theirs (`oidcFlow.ts`).
  if (!takeOidcFlow()) return false;

  try {
    const res = await requestWithoutSession("/api/auth/me", { bearer: token });
    if (!res.ok) return false;
    const body = (await res.json()) as AuthMeResponse;
    adoptSession({ token, user: body.user });
    return true;
  } catch {
    return false;
  }
}
