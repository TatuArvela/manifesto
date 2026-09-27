import type { AuditLogResponse } from "@manifesto/shared";
import { apiFetch } from "../storage/apiRequest.js";

/**
 * The signed-in user's own lines of the audit log: what an admin can see
 * about them, including what an admin did to their account. Resolves with
 * null rather than rejecting; the page says so in its own words.
 */
export async function loadAccountActivity(
  before?: string,
): Promise<AuditLogResponse | null> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  const res = await apiFetch("GET", `/auth/me/activity${query}`);
  if (!res?.ok) return null;
  return (await res.json()) as AuditLogResponse;
}
