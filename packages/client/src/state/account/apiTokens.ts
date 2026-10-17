import type {
  ApiToken,
  ApiTokenCreatedResponse,
  ApiTokenKind,
  ApiTokenScope,
  ApiTokensResponse,
} from "@manifesto/shared";
import { apiFetch } from "#/storage/apiRequest.ts";
import { sealer } from "#/storage/sealing.ts";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./passwordConfirmation.ts";

/**
 * The signed-in user's personal API tokens. Each call resolves with what
 * happened rather than rejecting; the dialog says it in its own words.
 */

/** Null if they could not be read. */
export async function listApiTokens(): Promise<ApiToken[] | null> {
  const res = await apiFetch("GET", "/tokens");
  if (!res?.ok) return null;
  return ((await res.json()) as ApiTokensResponse).tokens;
}

export type CreateApiTokenResult =
  | { kind: "ok"; created: ApiTokenCreatedResponse }
  | { kind: "too-many" }
  | { kind: "refused"; refusal: ConfirmationRefusal }
  | { kind: "failed" };

/** What each kind of token that carries keys starts with. */
const KEYED_PREFIX: Partial<Record<ApiTokenKind, string>> = {
  api: "mfp_",
  mcp: "mfm_",
  calendar: "mfc_",
};

/**
 * A script's token unless `kind` says otherwise, reaching what `scopes`
 * name (an MCP token only the note scopes).
 *
 * A token that reaches notes carries the keys to open them, so its secret is
 * made here and the server is sent its hash and the keys wrapped under it;
 * the server never sees the secret until the token is used. A calendar
 * feed's address is made the same way and carries the reminder key alone,
 * which opens the notes that have a reminder. A token for the account
 * alone is made by the server as before.
 */
export async function createApiToken(
  name: string,
  expiresInDays: number | null,
  kind: ApiTokenKind,
  scopes: readonly ApiTokenScope[],
  password: string,
): Promise<CreateApiTokenResult> {
  const prefix = KEYED_PREFIX[kind];
  const reachesNotes =
    kind === "calendar" || scopes.some((scope) => scope.startsWith("notes:"));
  let made: Awaited<ReturnType<NonNullable<typeof sealer.value>["newToken"]>> =
    null;
  if (prefix !== undefined && reachesNotes) {
    // Locked: no keys to give it, and a token without them is sent no note
    // it can open.
    const sealing = sealer.peek();
    if (!sealing) {
      console.warn("Cannot make a token's keys while locked");
      return { kind: "failed" };
    }
    try {
      made = await sealing.newToken(
        prefix,
        kind === "calendar" ? "reminders" : "notes",
      );
    } catch (err) {
      console.warn("Failed to make a token's keys:", err);
      return { kind: "failed" };
    }
  }
  const res = await apiFetch("POST", "/tokens", {
    name,
    ...made?.fields,
    ...(expiresInDays !== null && { expiresInDays }),
    // `api` is what a server takes when none is named, older ones included.
    ...(kind !== "api" && { kind }),
    // A calendar token reaches its feed, which no scope names.
    ...(kind !== "calendar" && { scopes }),
    ...(password && { password }),
  });
  if (res?.status === 409) return { kind: "too-many" };
  const refusal = res && (await confirmationRefusal(res));
  if (refusal) return { kind: "refused", refusal };
  if (!res?.ok) return { kind: "failed" };
  const created = (await res.json()) as ApiTokenCreatedResponse;
  return {
    kind: "ok",
    // The secret of a token made here is known here alone.
    created: made ? { ...created, secret: made.secret } : created,
  };
}

export async function revokeApiToken(id: string): Promise<boolean> {
  const res = await apiFetch("DELETE", `/tokens/${encodeURIComponent(id)}`);
  return res?.ok === true;
}
