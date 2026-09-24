import type {
  Webhook,
  WebhookCreatedResponse,
  WebhooksResponse,
} from "@manifesto/shared";
import { apiFetch } from "../storage/apiRequest.js";

/**
 * The signed-in user's webhooks. Like the API token calls, each resolves with
 * what happened and never rejects.
 */

export async function listWebhooks(): Promise<Webhook[] | null> {
  const res = await apiFetch("GET", "/webhooks");
  if (!res?.ok) return null;
  return ((await res.json()) as WebhooksResponse).webhooks;
}

export type CreateWebhookResult =
  | { kind: "ok"; created: WebhookCreatedResponse }
  | { kind: "invalid" | "too-many" | "failed" };

export async function createWebhook(url: string): Promise<CreateWebhookResult> {
  const res = await apiFetch("POST", "/webhooks", { url });
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
  const res = await apiFetch("PUT", `/webhooks/${encodeURIComponent(id)}`, {
    active,
  });
  return res?.ok === true;
}

export async function deleteWebhook(id: string): Promise<boolean> {
  const res = await apiFetch("DELETE", `/webhooks/${encodeURIComponent(id)}`);
  return res?.ok === true;
}

/** Null when the request itself failed; otherwise what the receiver said. */
export async function testWebhook(
  id: string,
): Promise<{ status: number | null; error: string | null } | null> {
  const res = await apiFetch(
    "POST",
    `/webhooks/${encodeURIComponent(id)}/test`,
  );
  if (!res?.ok) return null;
  return (await res.json()) as { status: number | null; error: string | null };
}
