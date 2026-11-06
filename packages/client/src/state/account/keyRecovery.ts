import type {
  AuthSuccessResponse,
  RecoveryCompleteRequest,
  RecoveryOpenResponse,
} from "@manifesto/shared";
import { cryptoAvailable } from "@manifesto/shared";
import { apiFetch } from "#/storage/apiRequest.ts";
import {
  type RecoveredKeys,
  recoverAccountKey,
  recoveryVerifierOf,
} from "#/utils/keyMaterial.ts";
import { parseUserKey } from "#/utils/userKey.ts";
import {
  adoptSession,
  currentUser,
  recoveryRequest,
  SERVER_ORIGIN,
} from "./auth.ts";
import { device, fetchKeys, hold, type KeySheet, setHeld } from "./keyHold.ts";

/**
 * The use of the recovery key: signed in, or from the sign-in screen. Both
 * answer a sheet with new keys first, and replace nothing until the person
 * says that they kept it. Import it through `accountKeys.ts`.
 */

export type RecoveryResult =
  | { kind: "ok"; sheet: KeySheet }
  | {
      kind:
        | "invalid"
        /** Not the recovery key of this account. */
        | "wrong"
        /** Too many wrong keys. Try again later. */
        | "throttled"
        | "failed";
    };

/**
 * Opens what the server gave, and makes the new keys. Both ways to use the
 * recovery key share it.
 */
async function openRecovery(
  recoveryKey: string,
  verifier: string,
  opened: RecoveryOpenResponse,
  username: string | null,
): Promise<RecoveryResult> {
  let recovered: RecoveredKeys | null;
  try {
    recovered = await recoverAccountKey(opened, recoveryKey);
  } catch {
    return { kind: "failed" };
  }
  // The server accepted the key, and its wrap does not open. Do not trust the
  // key.
  if (recovered === null) return { kind: "failed" };
  device.pendingRecovery = { recovered, verifier, opened, username };
  return {
    kind: "ok",
    sheet: {
      server: SERVER_ORIGIN ?? "",
      username: username ?? currentUser.value?.username ?? "",
      secretKey: recovered.secretKey,
      recoveryKey: recovered.recoveryKey,
    },
  };
}

async function verifierFor(input: string): Promise<{
  recoveryKey: string;
  verifier: string;
} | null> {
  const recoveryKey = parseUserKey(input, "recovery");
  if (recoveryKey === null || !cryptoAvailable()) return null;
  try {
    return { recoveryKey, verifier: await recoveryVerifierOf(recoveryKey) };
  } catch {
    return null;
  }
}

/**
 * The first step to use the recovery key while signed in, for a person who lost
 * the secret key. It checks the key with the server, and answers a sheet with a
 * new secret key and a new recovery key. Nothing is replaced until
 * `completeRecovery`.
 */
export async function beginRecovery(input: string): Promise<RecoveryResult> {
  const parsed = await verifierFor(input);
  if (parsed === null) return { kind: "invalid" };
  const res = await apiFetch("POST", "/auth/keys/recover", {
    verifier: parsed.verifier,
  });
  if (res?.status === 403) return { kind: "wrong" };
  if (res?.status === 429) return { kind: "throttled" };
  if (!res?.ok) return { kind: "failed" };
  let opened: RecoveryOpenResponse;
  try {
    opened = (await res.json()) as RecoveryOpenResponse;
  } catch {
    return { kind: "failed" };
  }
  return openRecovery(parsed.recoveryKey, parsed.verifier, opened, null);
}

/** The same with nobody signed in, by username. The recovery then signs in. */
export async function beginRecoverySignIn(
  username: string,
  input: string,
): Promise<RecoveryResult> {
  const parsed = await verifierFor(input);
  if (parsed === null) return { kind: "invalid" };
  const answer = await recoveryRequest<RecoveryOpenResponse>("open", {
    username,
    verifier: parsed.verifier,
  });
  if (answer.kind === "wrong" || answer.kind === "throttled") {
    return { kind: answer.kind };
  }
  if (answer.kind !== "ok") return { kind: "failed" };
  return openRecovery(
    parsed.recoveryKey,
    parsed.verifier,
    answer.body,
    username,
  );
}

/**
 * The second step. It puts the new keys in place of the keys that the recovery
 * used, and unlocks this device with them. With nobody signed in, it takes the
 * new password and signs in. `used` means that the recovery key was used in the
 * meantime.
 */
export async function completeRecovery(
  newPassword?: string,
): Promise<"ok" | "used" | "failed"> {
  const pending = device.pendingRecovery;
  if (!pending) return "failed";
  const { recovered, opened } = pending;
  const body: RecoveryCompleteRequest = {
    verifier: pending.verifier,
    wrappedBySecret: recovered.wrappedBySecret,
    wrappedByRecovery: recovered.wrappedByRecovery,
    recoveryVerifier: recovered.recoveryVerifier,
  };
  const keys = {
    userId: opened.userId,
    version: recovered.version,
    secretKey: recovered.secretKey,
    accountKey: recovered.accountKey,
  };
  if (pending.username === null) {
    const res = await apiFetch("POST", "/auth/keys/recover/complete", body);
    if (res?.status === 409 || res?.status === 403) return "used";
    if (!res?.ok) return "failed";
    return (await hold(keys, device.served?.sessionEndsAt ?? null))
      ? "ok"
      : "failed";
  }
  const answer = await recoveryRequest<AuthSuccessResponse>("complete", {
    ...body,
    username: pending.username,
    newPassword,
  });
  if (answer.kind === "used" || answer.kind === "wrong") return "used";
  if (answer.kind !== "ok") return "failed";
  // Held before the session starts. Thus, the check that follows the sign-in
  // finds the account unlocked, and asks for nothing.
  device.generation++;
  setHeld(keys);
  device.pendingRecovery = null;
  adoptSession(answer.body);
  const now = await fetchKeys();
  if (now) device.served = now;
  return (await hold(keys, now?.sessionEndsAt ?? null)) ? "ok" : "failed";
}

/** Drops a set-up or a recovery that is not complete. */
export function abandonRecovery(): void {
  device.pendingRecovery = null;
}
