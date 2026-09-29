import type {
  TwoFactorRecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { APP_NAME, INSTANCE_NAME } from "../config.js";
import { apiFetch } from "../storage/apiRequest.js";
import { currentUser } from "./auth.js";

/**
 * Two-factor sign-in for the signed-in local account. Each call resolves with
 * what happened, never rejects: `wrong-password` and `wrong-code` for the
 * dialog to say, `failed` for everything else.
 */

type Failure = { kind: "wrong-password" | "wrong-code" | "failed" };

function failureOf(res: Response | null): Failure {
  if (res?.status === 403) return { kind: "wrong-password" };
  if (res?.status === 422) return { kind: "wrong-code" };
  return { kind: "failed" };
}

/**
 * Whether an account signs in with a second factor (an authenticator, a
 * passkey or both), as the last status read for it said. Kept with the
 * account's id, so another account signing in on this tab never inherits it.
 */
const secondFactor = signal<{ userId: string; enabled: boolean } | null>(null);

/**
 * Whether the signed-in account has a second factor. Settings keeps its
 * two-factor page for such an account even when the server has turned both
 * halves off: sign-in still asks for the factor, and that page is the only
 * way to remove it or replace the recovery codes.
 */
export function hasSecondFactor(): boolean {
  const known = secondFactor.value;
  return (
    known !== null && known.userId === currentUser.value?.id && known.enabled
  );
}

export async function twoFactorStatus(): Promise<TwoFactorStatusResponse | null> {
  const userId = currentUser.value?.id;
  const res = await apiFetch("GET", "/auth/two-factor");
  if (!res?.ok) return null;
  const status = (await res.json()) as TwoFactorStatusResponse;
  if (userId) secondFactor.value = { userId, enabled: status.enabled };
  return status;
}

export async function beginTwoFactor(
  password: string,
): Promise<{ kind: "ok"; secret: string } | Failure> {
  const res = await apiFetch("POST", "/auth/two-factor/setup", { password });
  if (!res?.ok) return failureOf(res);
  return { kind: "ok", ...((await res.json()) as TwoFactorSetupResponse) };
}

export async function enableTwoFactor(
  code: string,
): Promise<{ kind: "ok"; recoveryCodes: string[] } | Failure> {
  const res = await apiFetch("POST", "/auth/two-factor/enable", { code });
  if (!res?.ok) return failureOf(res);
  return {
    kind: "ok",
    ...((await res.json()) as TwoFactorRecoveryCodesResponse),
  };
}

export async function disableTwoFactor(
  password: string,
): Promise<{ kind: "ok" } | Failure> {
  const res = await apiFetch("POST", "/auth/two-factor/disable", { password });
  return res?.ok ? { kind: "ok" } : failureOf(res);
}

export async function renewRecoveryCodes(
  password: string,
): Promise<{ kind: "ok"; recoveryCodes: string[] } | Failure> {
  const res = await apiFetch("POST", "/auth/two-factor/recovery-codes", {
    password,
  });
  if (!res?.ok) return failureOf(res);
  return {
    kind: "ok",
    ...((await res.json()) as TwoFactorRecoveryCodesResponse),
  };
}

/**
 * What an authenticator app takes, labelled with this deployment's name: the
 * server does not know what the app is called here, so the link is made on
 * this side. The instance goes in too when there is one, or two instances of
 * the same app make two entries nobody can tell apart.
 */
export function otpauthLink(username: string, secret: string): string {
  const issuer = INSTANCE_NAME ? `${APP_NAME} (${INSTANCE_NAME})` : APP_NAME;
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(username)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
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
