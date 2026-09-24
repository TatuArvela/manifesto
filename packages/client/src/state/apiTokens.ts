import type {
  ApiToken,
  ApiTokenCreatedResponse,
  ApiTokensResponse,
} from "@manifesto/shared";
import { apiFetch } from "../storage/apiRequest.js";

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
  | { kind: "failed" };

export async function createApiToken(
  name: string,
  expiresInDays: number | null,
): Promise<CreateApiTokenResult> {
  const res = await apiFetch("POST", "/tokens", {
    name,
    ...(expiresInDays !== null && { expiresInDays }),
  });
  if (res?.status === 409) return { kind: "too-many" };
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
