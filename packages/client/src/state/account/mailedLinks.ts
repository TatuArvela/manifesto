import type { PasskeyAuthenticationResponse } from "@manifesto/shared";
import {
  adoptSession,
  authRequest,
  requestWithoutSession,
  SERVER_URL,
} from "./auth.ts";

// The links that the server mails: one to set a new password, one to sign in
// without it. Requested and used with nobody signed in. Thus, each request goes
// out with no session (`requestWithoutSession`).

/**
 * Asks the server to mail a reset link. The server answers the same, whether
 * the address has an account or not. Thus, this tells only if the request
 * arrived. `locale` selects the language of the mail.
 */
export async function requestPasswordReset(
  email: string,
  locale: string,
): Promise<boolean> {
  if (SERVER_URL === null) return false;
  try {
    const res = await requestWithoutSession("/api/v1/auth/password-reset", {
      body: { email, locale },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sets a new password with the token of a mailed link. */
export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<"ok" | "expired" | "failed"> {
  if (SERVER_URL === null) return "failed";
  try {
    const res = await requestWithoutSession(
      "/api/v1/auth/password-reset/confirm",
      { body: { token, newPassword } },
    );
    if (res.status === 410) return "expired";
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * The token of a mailed link, taken from the fragment one time and removed from
 * the address bar. Thus, it does not stay in the history, and nobody behind the
 * person can see it.
 */
function takeLinkToken(name: "reset" | "signin"): string | null {
  if (typeof window === "undefined") return null;
  const match = /^#(reset|signin)=([0-9a-f]{16,200})$/.exec(
    window.location.hash,
  );
  if (match?.[1] !== name) return null;
  history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return match[2] ?? null;
}

/** The token of a mailed reset link, from `#reset=`. */
export function takeResetToken(): string | null {
  return takeLinkToken("reset");
}

/** The token of a mailed sign-in link, from `#signin=`. */
export function takeSignInLinkToken(): string | null {
  return takeLinkToken("signin");
}

/**
 * Asks the server to mail a sign-in link. As for a reset, the server answers
 * the same, whether the address has an account or not. Thus, `sent` tells only
 * that the request arrived. The code tells the refusals apart, because each
 * asks the person for a different thing: wait, or correct the address.
 */
export async function requestSignInLink(
  email: string,
  locale: string,
): Promise<"sent" | "throttled" | "invalid" | "failed"> {
  if (SERVER_URL === null) return "failed";
  try {
    const res = await requestWithoutSession("/api/v1/auth/sign-in-link", {
      body: { email, locale },
    });
    if (res.ok) return "sent";
    if (res.status === 429) return "throttled";
    return res.status === 422 ? "invalid" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Signs in with the token of a mailed link. Throws as `login` does. It throws a
 * `TwoFactorRequiredError` when the account has a second factor, after which
 * the same token goes again with the code or the answer of the passkey. It
 * throws an `AuthRequestError` with status 410 for a link that was used or
 * expired.
 */
export async function signInWithLink(
  token: string,
  otp?: string,
  passkey?: PasskeyAuthenticationResponse,
): Promise<void> {
  const result = await authRequest("/api/v1/auth/sign-in-link/confirm", {
    token,
    ...(otp === undefined ? {} : { otp }),
    ...(passkey === undefined ? {} : { passkey }),
  });
  adoptSession(result);
}
