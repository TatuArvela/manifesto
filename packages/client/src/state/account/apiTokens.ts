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
 * The personal API tokens of the signed-in user. Each call resolves with what
 * occurred, and does not reject. The dialog tells it in its own words.
 */

/** Null if the client could not read them. */
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

/** The start of each kind of token that carries keys. */
const KEYED_PREFIX: Partial<Record<ApiTokenKind, string>> = {
  api: "mfp_",
  mcp: "mfm_",
  calendar: "mfc_",
};

/**
 * A token for a script unless `kind` says differently, with access to what
 * `scopes` names (an MCP token only the note scopes).
 *
 * A token that reaches notes carries the keys to open them. Thus, its secret is
 * made here, and the server gets its hash and the keys wrapped under it. The
 * server never sees the secret until the token is used. The address of a
 * calendar feed is made in the same way, and carries only the reminder key,
 * which opens the notes that have a reminder. The server makes a token only for
 * the account, as before.
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
    // Locked: there are no keys to give it, and a token without them gets no
    // note that it can open.
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
    // A server takes `api` when no kind is named, also older servers.
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
    // Only this client knows the secret of a token made here.
    created: made ? { ...created, secret: made.secret } : created,
  };
}

export async function revokeApiToken(id: string): Promise<boolean> {
  const res = await apiFetch("DELETE", `/tokens/${encodeURIComponent(id)}`);
  return res?.ok === true;
}
