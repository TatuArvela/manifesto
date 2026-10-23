import type {
  DeviceLinkResponse,
  PasskeyAuthenticationResponse,
} from "@manifesto/shared";
import { apiFetch } from "#/storage/apiRequest.ts";
import { holdScannedSecretKey, revealSecretKey } from "./accountKeys.ts";
import { adoptSession, authRequest } from "./auth.ts";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./passwordConfirmation.ts";

// A QR code that signs in a second device. A signed-in device makes it, and
// the second device opens it with its camera. The address carries a one-time
// token for the server and, when this device holds it, the secret key, which
// unlocks the notes there. The key is in the fragment. Thus, it never goes to
// the server, the same as the key QR code of Settings.

export type DeviceLinkResult =
  | { kind: "ok"; address: string; expiresAt: string }
  | { kind: ConfirmationRefusal | "failed" };

/**
 * Makes a code after the server checked the password. The secret key is added
 * only after its own check, because a key shows only after the password.
 */
export async function createDeviceLink(
  password: string,
): Promise<DeviceLinkResult> {
  const body = password ? { password } : {};
  const res = await apiFetch("POST", "/auth/device-link", body);
  if (!res?.ok) {
    const refusal = res ? await confirmationRefusal(res) : null;
    return { kind: refusal ?? "failed" };
  }
  const { token, expiresAt } = (await res.json()) as DeviceLinkResponse;
  const revealed = await revealSecretKey(password);
  const key = revealed.kind === "ok" ? revealed.secretKey : null;
  return { kind: "ok", address: deviceLinkAddress(token, key), expiresAt };
}

/** The address that the QR code carries. */
export function deviceLinkAddress(token: string, secretKey: string | null) {
  if (typeof window === "undefined") return "";
  const app = new URL(import.meta.env.BASE_URL, window.location.origin);
  return `${app.href}#device=${token}${secretKey ? `&key=${secretKey}` : ""}`;
}

/**
 * The token of a scanned code, taken from the fragment one time and removed
 * from the address bar. The secret key in it goes to `holdScannedSecretKey`,
 * which unlocks with it after the sign-in, unless `holdKey` is false (a code
 * that opens where a person is already signed in). Null when the address has no
 * code.
 */
export function takeDeviceLinkToken({ holdKey = true } = {}): string | null {
  if (typeof window === "undefined") return null;
  const match =
    /^#device=([0-9a-f]{16,200})(?:&key=([-0-9A-Za-z]{28,40}))?$/.exec(
      window.location.hash,
    );
  if (!match) return null;
  history.replaceState(
    history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  if (holdKey && match[2]) holdScannedSecretKey(match[2]);
  return match[1] ?? null;
}

/**
 * Signs in with the token of a scanned code. Throws as `signInWithLink` of a
 * mailed link does: `TwoFactorRequiredError` for an account with a second
 * factor, and an `AuthRequestError` with status 410 for a used or expired code.
 */
export async function signInWithDeviceLink(
  token: string,
  otp?: string,
  passkey?: PasskeyAuthenticationResponse,
): Promise<void> {
  const result = await authRequest("/api/v1/auth/device-link/confirm", {
    token,
    ...(otp === undefined ? {} : { otp }),
    ...(passkey === undefined ? {} : { passkey }),
  });
  adoptSession(result);
}
