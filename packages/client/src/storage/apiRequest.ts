import type { ErrorResponse } from "@manifesto/shared";
import { storageConnection } from "./index.js";

/**
 * Signed-in requests to the server's `/api`, for the account-level modules
 * (admin, sharing, tokens, webhooks, two-factor) that are not note storage.
 * A 401 answer ends the session through the connection's `onUnauthorized`.
 */

/** A request the server refused, or one that could not be made. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code?: ErrorResponse["code"],
  ) {
    super(`API request failed (${status})`);
  }
}

/**
 * The server's answer, whatever its status; null when there is no session to
 * send it with or it never arrived. Never rejects.
 */
export async function apiFetch(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response | null> {
  const { serverUrl, token, onUnauthorized } = storageConnection.value;
  // `=== null`, not falsiness: a same-origin deployment's base is "".
  if (serverUrl === null || !token) return null;
  try {
    const res = await fetch(`${serverUrl}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (res.status === 401) onUnauthorized?.();
    return res;
  } catch {
    return null;
  }
}

/**
 * The parsed body of a successful answer, null for a 204. Throws `ApiError`
 * otherwise: status 401 with no session, 0 when the request never arrived.
 */
export async function apiJson<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const { serverUrl, token } = storageConnection.value;
  if (serverUrl === null || !token) throw new ApiError(401);
  const res = await apiFetch(method, path, body);
  if (!res) throw new ApiError(0);
  if (!res.ok) {
    let code: ErrorResponse["code"];
    try {
      code = ((await res.json()) as Partial<ErrorResponse>).code;
    } catch {
      // not JSON; the status says enough
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return null;
  return (await res.json()) as T;
}
