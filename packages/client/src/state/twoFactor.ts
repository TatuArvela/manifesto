import type {
  TwoFactorRecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@manifesto/shared";
import { APP_NAME } from "../config.js";
import { authToken, clearAuthLocal, SERVER_URL } from "./auth.js";

/**
 * Two-factor sign-in for the signed-in local account. Each call resolves with
 * what happened, never rejects: `wrong-password` and `wrong-code` for the
 * dialog to say, `failed` for everything else.
 */

type Failure = { kind: "wrong-password" | "wrong-code" | "failed" };

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response | null> {
  const token = authToken.value;
  if (SERVER_URL === null || !token) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/two-factor${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (res.status === 401) clearAuthLocal();
    return res;
  } catch {
    return null;
  }
}

function failureOf(res: Response | null): Failure {
  if (res?.status === 403) return { kind: "wrong-password" };
  if (res?.status === 422) return { kind: "wrong-code" };
  return { kind: "failed" };
}

export async function twoFactorStatus(): Promise<TwoFactorStatusResponse | null> {
  const res = await request("GET", "");
  return res?.ok ? ((await res.json()) as TwoFactorStatusResponse) : null;
}

export async function beginTwoFactor(
  password: string,
): Promise<{ kind: "ok"; secret: string } | Failure> {
  const res = await request("POST", "/setup", { password });
  if (!res?.ok) return failureOf(res);
  return { kind: "ok", ...((await res.json()) as TwoFactorSetupResponse) };
}

export async function enableTwoFactor(
  code: string,
): Promise<{ kind: "ok"; recoveryCodes: string[] } | Failure> {
  const res = await request("POST", "/enable", { code });
  if (!res?.ok) return failureOf(res);
  return {
    kind: "ok",
    ...((await res.json()) as TwoFactorRecoveryCodesResponse),
  };
}

export async function disableTwoFactor(
  password: string,
): Promise<{ kind: "ok" } | Failure> {
  const res = await request("POST", "/disable", { password });
  return res?.ok ? { kind: "ok" } : failureOf(res);
}

export async function renewRecoveryCodes(
  password: string,
): Promise<{ kind: "ok"; recoveryCodes: string[] } | Failure> {
  const res = await request("POST", "/recovery-codes", { password });
  if (!res?.ok) return failureOf(res);
  return {
    kind: "ok",
    ...((await res.json()) as TwoFactorRecoveryCodesResponse),
  };
}

/**
 * What an authenticator app takes, labelled with this deployment's name: the
 * server does not know what the app is called here, so the link is made on
 * this side.
 */
export function otpauthLink(username: string, secret: string): string {
  const label = `${encodeURIComponent(APP_NAME)}:${encodeURIComponent(username)}`;
  const params = new URLSearchParams({
    secret,
    issuer: APP_NAME,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params}`;
}

/** The secret in groups of four, as it is easiest to type. */
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}
