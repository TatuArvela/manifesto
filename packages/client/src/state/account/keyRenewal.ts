import type { AccountKeys } from "@manifesto/shared";
import { apiFetch } from "#/storage/apiRequest.ts";
import { replaceRecoveryKey, replaceSecretKey } from "#/utils/keyMaterial.ts";
import { device, fetchKeys, hold, type KeySheet, sheet } from "./keyHold.ts";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./passwordConfirmation.ts";

/**
 * What Settings does with the keys of an unlocked account: show the secret
 * key, and make a new secret key or recovery key. Each one confirms the
 * password first. Import it through `accountKeys.ts`.
 */

export type Confirmed<T> =
  | ({ kind: "ok" } & T)
  | { kind: ConfirmationRefusal | "failed" };

/** What a refused or failed request says, for the forms that confirm. */
export async function refusalOf(
  res: Response | null,
): Promise<{ kind: ConfirmationRefusal | "failed" }> {
  const refusal = res ? await confirmationRefusal(res) : null;
  return { kind: refusal ?? "failed" };
}

export const withPassword = (password: string) =>
  password ? { password } : {};

/**
 * The secret key that this device has, after the server checked the password
 * (or, for an account without one, a recent sign-in). Settings shows it to
 * bring in a different device.
 */
export async function revealSecretKey(
  password: string,
): Promise<Confirmed<{ secretKey: string }>> {
  const secretKey = device.held?.secretKey;
  if (!secretKey) return { kind: "failed" };
  const res = await apiFetch(
    "POST",
    "/auth/keys/confirm",
    withPassword(password),
  );
  if (!res?.ok) return refusalOf(res);
  return { kind: "ok", secretKey };
}

/**
 * The wrap that the server has now. The secret key here must open it before the
 * code can wrap anything again.
 */
async function currentKeys(): Promise<AccountKeys | null> {
  const answer = await fetchKeys();
  if (answer) device.served = answer;
  return answer?.keys ?? null;
}

/**
 * Makes a new secret key in place of the key that this device has, after the
 * server checked the password, and answers it to show. Nothing is replaced
 * until `completeRenewal`, after the user says that they kept it.
 */
export async function prepareSecretKey(
  password: string,
): Promise<Confirmed<{ secretKey: string }>> {
  const made = await prepareRenewal(password, replaceSecretKey);
  if (made.kind !== "ok") return made;
  device.pendingRenewal = { kind: "secret", ...made.next };
  return { kind: "ok", secretKey: made.next.secretKey };
}

/** The same for a new recovery key. */
export async function prepareRecoveryKey(
  password: string,
): Promise<Confirmed<{ recoveryKey: string }>> {
  const made = await prepareRenewal(password, replaceRecoveryKey);
  if (made.kind !== "ok") return made;
  device.pendingRenewal = { kind: "recovery", ...made.next };
  return { kind: "ok", recoveryKey: made.next.recoveryKey };
}

async function prepareRenewal<T>(
  password: string,
  replace: (
    userId: string,
    keys: AccountKeys,
    secretKey: string,
  ) => Promise<T | null>,
): Promise<Confirmed<{ next: T }>> {
  device.pendingRenewal = null;
  const mine = device.held;
  if (!mine) return { kind: "failed" };
  const confirmed = await apiFetch(
    "POST",
    "/auth/keys/confirm",
    withPassword(password),
  );
  if (!confirmed?.ok) return refusalOf(confirmed);
  const keys = await currentKeys();
  if (!keys) return { kind: "failed" };
  let next: T | null;
  try {
    next = await replace(mine.userId, keys, mine.secretKey);
  } catch {
    return { kind: "failed" };
  }
  return next === null ? { kind: "failed" } : { kind: "ok", next };
}

/**
 * Puts the key that `prepareSecretKey` or `prepareRecoveryKey` made in place of
 * the old key. A new secret key signs out each other device, and this device
 * continues with it.
 */
export async function completeRenewal(
  password: string,
): Promise<Confirmed<object>> {
  const pending = device.pendingRenewal;
  const mine = device.held;
  if (!pending || !mine) return { kind: "failed" };
  if (pending.kind === "recovery") {
    const res = await apiFetch("POST", "/auth/keys/recovery", {
      ...withPassword(password),
      wrappedByRecovery: pending.wrappedByRecovery,
      recoveryVerifier: pending.recoveryVerifier,
    });
    if (!res?.ok) return refusalOf(res);
    device.pendingRenewal = null;
    return { kind: "ok" };
  }
  const res = await apiFetch("POST", "/auth/keys/secret", {
    ...withPassword(password),
    wrappedBySecret: pending.wrappedBySecret,
  });
  // A request whose answer was lost can still have occurred. The wrap that the
  // server has tells, and this device must continue with the key that opens it.
  const made =
    res?.ok ||
    (!res &&
      (await currentKeys())?.wrappedBySecret === pending.wrappedBySecret);
  if (!made) return refusalOf(res);
  device.pendingRenewal = null;
  await hold(
    { ...mine, secretKey: pending.secretKey },
    device.served?.sessionEndsAt ?? null,
  );
  return { kind: "ok" };
}

/** Drops a new key whose sheet was not kept. The old key continues to work. */
export function abandonRenewal(): void {
  device.pendingRenewal = null;
}

/** A sheet for one new key, to save next to the old key or in its place. */
export function sheetFor(key: {
  secretKey?: string;
  recoveryKey?: string;
}): KeySheet {
  return sheet(key.secretKey ?? null, key.recoveryKey ?? null);
}
