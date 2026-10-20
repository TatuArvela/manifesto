import type { AuthMeResponse } from "@manifesto/shared";
import { signal } from "@preact/signals";
import { adoptSession, requestWithoutSession, SERVER_URL } from "./auth.ts";
import { markOidcFlow, takeOidcFlow } from "./oidcFlow.ts";

// The sign-in through the identity provider of the server: the addresses that
// start it, and the start of the session with which it comes back.

export function buildOidcLoginUrl(): string | null {
  if (SERVER_URL === null) return null;
  return `${SERVER_URL}/api/v1/auth/login`;
}

export const oidcLoginUrl = buildOidcLoginUrl();

/**
 * Signs in through the identity provider again, which asks for real, and does
 * not use its own session again. An account without a password goes here when
 * an action needs a recent sign-in.
 */
export const oidcReauthUrl =
  oidcLoginUrl === null ? null : `${oidcLoginUrl}?reauth=1`;

/**
 * What a link to one of the addresses above runs when you follow it. Only a tab
 * that left this mark takes the session that comes back.
 */
export const beginOidcSignIn = (): void => markOidcFlow();

export type OidcRefusal =
  | "not_in_group"
  | "not_registered"
  | "groups_unavailable";

/**
 * Why the server refused a single sign-on that the identity provider accepted:
 * not in the group that can sign in, no account while registration is off, or
 * groups that it could not read. Set from the `#error=` of the callback, for
 * the login screen to tell.
 */
export const oidcRefusal = signal<OidcRefusal | null>(null);

/**
 * After an OIDC callback, the server redirects to the client with the session
 * token in the URL fragment (`#token=...`). This gets it, gets the current user
 * through /api/v1/auth/me, fills the auth signals, and clears the fragment from
 * the address bar. Thus, a refresh does not start the flow again.
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

  // Clear the hash before any await. Thus, a slow /me round trip does not leave
  // the token in the address bar.
  history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );

  // Only a sign-in to which this tab sent the browser. A `#token=` in a link
  // that a person got is the session of the sender, not theirs (`oidcFlow.ts`).
  if (!takeOidcFlow()) return false;

  try {
    const res = await requestWithoutSession("/api/v1/auth/me", {
      bearer: token,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as AuthMeResponse;
    adoptSession({ token, user: body.user });
    return true;
  } catch {
    return false;
  }
}
