import type {
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { APP_NAME, INSTANCE_NAME } from "#/config.ts";
import { apiFetch } from "#/storage/apiRequest.ts";
import { currentUser } from "./auth.ts";

/**
 * Two-factor sign-in for the signed-in local account. Each call resolves with
 * what occurred, and never rejects: `wrong-password` and `wrong-code` for the
 * dialog to tell, `failed` for all other results.
 */

type Failure = { kind: "wrong-password" | "wrong-code" | "failed" };

function failureOf(res: Response | null): Failure {
  if (res?.status === 403) return { kind: "wrong-password" };
  if (res?.status === 422) return { kind: "wrong-code" };
  return { kind: "failed" };
}

/**
 * If an account signs in with a second factor (an authenticator, a passkey or
 * both), as the last status read for it said. Kept with the id of the account.
 * Thus, a different account that signs in on this tab never gets it.
 */
const secondFactor = signal<{ userId: string; enabled: boolean } | null>(null);

/**
 * If the signed-in account has a second factor. Settings keeps the two-factor
 * section of Sign-in for such an account when the server turned off both
 * halves. The sign-in still asks for the factor, and that section is the only
 * way to remove it.
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
): Promise<{ kind: "ok" } | Failure> {
  const res = await apiFetch("POST", "/auth/two-factor/enable", { code });
  return res?.ok ? { kind: "ok" } : failureOf(res);
}

export async function disableTwoFactor(
  password: string,
): Promise<{ kind: "ok" } | Failure> {
  const res = await apiFetch("POST", "/auth/two-factor/disable", { password });
  return res?.ok ? { kind: "ok" } : failureOf(res);
}

/**
 * What an authenticator app takes, with the name of this deployment as its
 * label. The server does not know the name of the app here. Thus, this side
 * makes the link. The instance is also included when there is one. If not, two
 * instances of the same app make two entries that nobody can tell apart.
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
