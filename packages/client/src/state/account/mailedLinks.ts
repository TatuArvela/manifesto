import type { PasskeyAuthenticationResponse } from "@manifesto/shared";
import {
  adoptSession,
  authRequest,
  requestWithoutSession,
  SERVER_URL,
} from "./auth.ts";

// The links the server mails: one to set a new password, one to sign in
// without it. Asked for and spent with nobody signed in, so every request
// goes out with no session (`requestWithoutSession`).

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
    const res = await requestWithoutSession("/api/auth/password-reset", {
      body: { email, locale },
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
    const res = await requestWithoutSession(
      "/api/auth/password-reset/confirm",
      { body: { token, newPassword } },
    );
    if (res.status === 410) return "expired";
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * A mailed link's token, taken from the fragment once and removed from the
 * address bar, so it is not left in history or shown over someone's shoulder.
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

/** A mailed reset link's token, from `#reset=`. */
export function takeResetToken(): string | null {
  return takeLinkToken("reset");
}

/** A mailed sign-in link's token, from `#signin=`. */
export function takeSignInLinkToken(): string | null {
  return takeLinkToken("signin");
}

/**
 * Asks for a sign-in link to be mailed. As with a reset, the server answers
 * the same whether or not the address has an account, so `sent` says only
 * that the request got there. The refusals are told apart because each asks
 * something different of the person: wait, or fix the address.
 */
export async function requestSignInLink(
  email: string,
  locale: string,
): Promise<"sent" | "throttled" | "invalid" | "failed"> {
  if (SERVER_URL === null) return "failed";
  try {
    const res = await requestWithoutSession("/api/auth/sign-in-link", {
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
 * Signs in with a mailed link's token. Throws as `login` does: a
 * `TwoFactorRequiredError` when the account has a second factor, after which
 * the same token is sent again with the code or the passkey's answer, and an
 * `AuthRequestError` with status 410 for a link that is spent or expired.
 */
export async function signInWithLink(
  token: string,
  otp?: string,
  passkey?: PasskeyAuthenticationResponse,
): Promise<void> {
  const result = await authRequest("/api/auth/sign-in-link/confirm", {
    token,
    ...(otp === undefined ? {} : { otp }),
    ...(passkey === undefined ? {} : { passkey }),
  });
  adoptSession(result);
}
