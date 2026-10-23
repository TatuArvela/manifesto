import {
  type DeviceRequestKeys,
  type DeviceSignInKey,
  type DeviceSignInRequestResponse,
  type DeviceSignInStartedResponse,
  type DeviceSignInWaitResponse,
  deviceMatchCode,
  newDeviceRequestKeys,
  openOnDevice,
  wrapForDevice,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { apiFetch } from "#/storage/apiRequest.ts";
import { holdScannedSecretKey, revealSecretKey } from "./accountKeys.ts";
import { adoptSession, requestWithoutSession, SERVER_URL } from "./auth.ts";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./passwordConfirmation.ts";

// A new device signs in by a QR code that it shows, and a device that is
// already signed in approves it (`auth/deviceSignIn.ts` on the server). The
// code carries the id of the request and the public half of a key pair that
// the new device made for it. The approval wraps the secret key to that key.
// Thus, the server carries the key, and cannot read it.

/** A request on the new device, while its code shows. */
export interface DeviceRequest {
  id: string;
  waitToken: string;
  expiresAt: number;
  keys: DeviceRequestKeys;
  /** What the QR code carries. */
  address: string;
  /** The six digits to type on the approving device. */
  matchCode: string;
}

/** The address of the approval, as `#approve=<id>&pk=<public key>`. */
function approvalAddress(id: string, publicKey: string): string {
  if (typeof window === "undefined") return "";
  const app = new URL(import.meta.env.BASE_URL, window.location.origin);
  return `${app.href}#approve=${id}&pk=${publicKey}`;
}

/** Starts a request on the sign-in screen. Null when the server refused. */
export async function startDeviceSignIn(): Promise<DeviceRequest | null> {
  if (SERVER_URL === null) return null;
  try {
    const keys = await newDeviceRequestKeys();
    const res = await requestWithoutSession("/api/v1/auth/device-sign-in", {
      body: {},
    });
    if (!res.ok) return null;
    const started = (await res.json()) as DeviceSignInStartedResponse;
    return {
      id: started.id,
      waitToken: started.waitToken,
      expiresAt: Date.parse(started.expiresAt),
      keys,
      address: approvalAddress(started.id, keys.publicKey),
      matchCode: await deviceMatchCode(started.id, keys.publicKey),
    };
  } catch (err) {
    console.warn("Failed to start a device sign-in:", err);
    return null;
  }
}

/**
 * Asks one time if the request was approved. On `signedIn`, the session is
 * adopted, and the secret key, when it came, waits to unlock. `gone` is a
 * request that expired or was used.
 */
export async function checkDeviceSignIn(
  request: DeviceRequest,
): Promise<"pending" | "signedIn" | "gone" | "failed"> {
  let res: Response;
  try {
    res = await requestWithoutSession("/api/v1/auth/device-sign-in/wait", {
      body: { waitToken: request.waitToken },
    });
  } catch {
    return "failed";
  }
  if (res.status === 202) return "pending";
  if (res.status === 410) return "gone";
  if (!res.ok) return "failed";
  const done = (await res.json()) as Exclude<
    DeviceSignInWaitResponse,
    { pending: true }
  >;
  if (done.key) {
    const secretKey = await openOnDevice(
      request.id,
      request.keys.privateKey,
      done.key,
    );
    // A key that does not open is not a reason to refuse the session. The
    // account then asks for the key as after each other sign-in.
    if (secretKey !== null) holdScannedSecretKey(secretKey);
  }
  // After the key. Thus, the check that the session starts finds it.
  adoptSession({ token: done.token, user: done.user });
  return "signedIn";
}

/** A scanned request on the approving device, until it is approved or closed. */
export interface ScannedRequest {
  id: string;
  publicKey: string;
}

/**
 * The request that the camera opened here. It waits through a sign-in, when
 * this browser was not signed in yet.
 */
export const scannedDeviceRequest = signal<ScannedRequest | null>(null);

/**
 * Takes `#approve=` from the address one time, and removes it from the address
 * bar and the history.
 */
export function takeDeviceRequestFromAddress(): void {
  if (typeof window === "undefined") return;
  const match = /^#approve=([0-9a-f]{64})&pk=(B[A-Za-z0-9_-]{86})$/.exec(
    window.location.hash,
  );
  if (!match) return;
  history.replaceState(
    history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  const [, id = "", publicKey = ""] = match;
  scannedDeviceRequest.value = { id, publicKey };
}

/** What the server knows about a scanned request. Null when it is gone. */
export async function inspectDeviceSignIn(
  id: string,
): Promise<DeviceSignInRequestResponse | "gone" | "failed"> {
  const res = await apiFetch("POST", "/auth/device-sign-in/inspect", { id });
  if (res?.status === 410) return "gone";
  if (!res?.ok) return "failed";
  return (await res.json()) as DeviceSignInRequestResponse;
}

/**
 * "Not me": ends the request, and the log of the account records it. A request
 * that is already gone needs nothing, so the answer is not shown.
 */
export async function denyDeviceSignIn(id: string): Promise<void> {
  await apiFetch("POST", "/auth/device-sign-in/deny", { id });
}

export type ApproveResult =
  | { kind: "ok" | "gone" | "failed" | "wrongCode" }
  | {
      kind: ConfirmationRefusal;
    };

/**
 * Approves a scanned request after the person typed its matching code, with
 * the password. The secret key goes with it when this device holds it, wrapped
 * to the public key from the code. A refusal of the password stops it before
 * anything is approved.
 */
export async function approveDeviceSignIn(
  request: ScannedRequest,
  typedCode: string,
  password: string,
): Promise<ApproveResult> {
  const expected = await deviceMatchCode(request.id, request.publicKey);
  if (typedCode.replace(/\D/g, "") !== expected.replace(/\D/g, "")) {
    return { kind: "wrongCode" };
  }
  let key: DeviceSignInKey | undefined;
  const revealed = await revealSecretKey(password);
  if (revealed.kind === "ok") {
    try {
      key = await wrapForDevice(
        request.id,
        request.publicKey,
        revealed.secretKey,
      );
    } catch (err) {
      console.warn("Failed to wrap the key for the new device:", err);
      return { kind: "failed" };
    }
  } else if (revealed.kind !== "failed") {
    return { kind: revealed.kind };
  }
  const res = await apiFetch("POST", "/auth/device-sign-in/approve", {
    id: request.id,
    ...(key && { key }),
    ...(password && { password }),
  });
  if (res?.status === 410) return { kind: "gone" };
  const refusal = res && (await confirmationRefusal(res));
  if (refusal) return { kind: refusal };
  return { kind: res?.ok ? "ok" : "failed" };
}
