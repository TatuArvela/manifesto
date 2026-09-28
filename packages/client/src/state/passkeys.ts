import type {
  Passkey,
  PasskeyAddedResponse,
  PasskeyOptionsResponse,
  PasskeysResponse,
} from "@manifesto/shared";
import { apiFetch } from "../storage/apiRequest.js";
import { createPasskey } from "../utils/webauthn.js";

/**
 * The signed-in local account's passkeys. Each call resolves with what
 * happened, never rejects, for the settings tab to say in its own words.
 */

/** Null if they could not be read. */
export async function listPasskeys(): Promise<Passkey[] | null> {
  const res = await apiFetch("GET", "/auth/passkeys");
  if (!res?.ok) return null;
  return ((await res.json()) as PasskeysResponse).passkeys;
}

export type AddPasskeyResult =
  | { kind: "ok"; recoveryCodes: string[] | null }
  | {
      kind: "wrong-password" | "cancelled" | "exists" | "too-many" | "failed";
    };

/** Asks the server for a challenge (with the password), has the browser make
 * a passkey for it, and hands that back to be kept. */
export async function addPasskey(
  name: string,
  password: string,
): Promise<AddPasskeyResult> {
  const started = await apiFetch("POST", "/auth/passkeys/options", {
    password,
  });
  if (started?.status === 403) return { kind: "wrong-password" };
  if (started?.status === 409) return { kind: "too-many" };
  if (!started?.ok) return { kind: "failed" };
  const { options } = (await started.json()) as PasskeyOptionsResponse;
  const response = await createPasskey(options);
  if (typeof response === "string") return { kind: response };
  const res = await apiFetch("POST", "/auth/passkeys", {
    ...(name && { name }),
    response,
  });
  if (res?.status === 409) return { kind: "exists" };
  if (!res?.ok) return { kind: "failed" };
  const { recoveryCodes } = (await res.json()) as PasskeyAddedResponse;
  return { kind: "ok", recoveryCodes };
}

export async function removePasskey(
  id: string,
  password: string,
): Promise<"ok" | "wrong-password" | "failed"> {
  const res = await apiFetch(
    "DELETE",
    `/auth/passkeys/${encodeURIComponent(id)}`,
    { password },
  );
  if (res?.ok) return "ok";
  return res?.status === 403 ? "wrong-password" : "failed";
}
