import type {
  Passkey,
  PasskeyOptionsResponse,
  PasskeysResponse,
} from "@manifesto/shared";
import { apiFetch } from "#/storage/apiRequest.ts";
import { createPasskey } from "#/utils/webauthn.ts";

/**
 * The passkeys of the signed-in local account. Each call resolves with what
 * occurred, and never rejects, so that the settings tab can tell it in its own
 * words.
 */

/** Null if the client could not read them. */
export async function listPasskeys(): Promise<Passkey[] | null> {
  const res = await apiFetch("GET", "/auth/passkeys");
  if (!res?.ok) return null;
  return ((await res.json()) as PasskeysResponse).passkeys;
}

export type AddPasskeyResult =
  | { kind: "ok" }
  | {
      kind: "wrong-password" | "cancelled" | "exists" | "too-many" | "failed";
    };

/**
 * Asks the server for a challenge (with the password), lets the browser make a
 * passkey for it, and gives that back for the server to keep.
 */
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
  return { kind: "ok" };
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
