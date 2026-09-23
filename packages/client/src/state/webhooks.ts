import type {
  Webhook,
  WebhookCreatedResponse,
  WebhooksResponse,
} from "@manifesto/shared";
import { authToken, clearAuthLocal, SERVER_URL } from "./auth.js";

/**
 * The signed-in user's webhooks. Like the API token calls, each resolves with
 * what happened and never rejects.
 */

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response | null> {
  const token = authToken.value;
  if (SERVER_URL === null || !token) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/webhooks${path}`, {
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

export async function listWebhooks(): Promise<Webhook[] | null> {
  const res = await request("GET", "");
  if (!res?.ok) return null;
  return ((await res.json()) as WebhooksResponse).webhooks;
}

export type CreateWebhookResult =
  | { kind: "ok"; created: WebhookCreatedResponse }
  | { kind: "invalid" | "too-many" | "failed" };

export async function createWebhook(url: string): Promise<CreateWebhookResult> {
  const res = await request("POST", "", { url });
  if (res?.status === 422) return { kind: "invalid" };
  if (res?.status === 409) return { kind: "too-many" };
  if (!res?.ok) return { kind: "failed" };
  return {
    kind: "ok",
    created: (await res.json()) as WebhookCreatedResponse,
  };
}

export async function setWebhookActive(
  id: string,
  active: boolean,
): Promise<boolean> {
  const res = await request("PUT", `/${encodeURIComponent(id)}`, { active });
  return res?.ok === true;
}

export async function deleteWebhook(id: string): Promise<boolean> {
  const res = await request("DELETE", `/${encodeURIComponent(id)}`);
  return res?.ok === true;
}

/** Null when the request itself failed; otherwise what the receiver said. */
export async function testWebhook(
  id: string,
): Promise<{ status: number | null; error: string | null } | null> {
  const res = await request("POST", `/${encodeURIComponent(id)}/test`);
  if (!res?.ok) return null;
  return (await res.json()) as { status: number | null; error: string | null };
}
