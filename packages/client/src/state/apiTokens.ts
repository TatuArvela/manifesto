import type {
  ApiToken,
  ApiTokenCreatedResponse,
  ApiTokenKind,
  ApiTokenScope,
  ApiTokensResponse,
} from "@manifesto/shared";
import { apiFetch } from "../storage/apiRequest.js";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./passwordConfirmation.js";

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

/** A script's token unless `kind` says otherwise, reaching what `scopes`
 * name (an MCP token only the note scopes). */
export async function createApiToken(
  name: string,
  expiresInDays: number | null,
  kind: ApiTokenKind,
  scopes: readonly ApiTokenScope[],
  password: string,
): Promise<CreateApiTokenResult> {
  const res = await apiFetch("POST", "/tokens", {
    name,
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
  return {
    kind: "ok",
    created: (await res.json()) as ApiTokenCreatedResponse,
  };
}

export async function revokeApiToken(id: string): Promise<boolean> {
  const res = await apiFetch("DELETE", `/tokens/${encodeURIComponent(id)}`);
  return res?.ok === true;
}
