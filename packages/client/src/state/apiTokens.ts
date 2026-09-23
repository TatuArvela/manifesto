import type {
  ApiToken,
  ApiTokenCreatedResponse,
  ApiTokensResponse,
} from "@manifesto/shared";
import { authToken, clearAuthLocal, SERVER_URL } from "./auth.js";

/**
 * The signed-in user's personal API tokens. Each call resolves with what
 * happened rather than rejecting; the dialog says it in its own words.
 */

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response | null> {
  const token = authToken.value;
  if (SERVER_URL === null || !token) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/tokens${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (res.status === 401) clearAuthLocal();
    return res;
  } catch {
    return null;
  }
}

/** Null if they could not be read. */
export async function listApiTokens(): Promise<ApiToken[] | null> {
  const res = await request("GET", "");
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
  const res = await request("POST", "", {
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
  const res = await request("DELETE", `/${encodeURIComponent(id)}`);
  return res?.ok === true;
}
