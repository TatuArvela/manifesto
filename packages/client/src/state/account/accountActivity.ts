import type { AuditLogResponse } from "@manifesto/shared";
import { apiFetch } from "#/storage/apiRequest.ts";

/**
 * The lines of the audit log about the signed-in user: what an admin can see
 * about them, also what an admin did to their account. Resolves with null, and
 * does not reject. The page tells this in its own words.
 */
export async function loadAccountActivity(
  before?: string,
): Promise<AuditLogResponse | null> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  const res = await apiFetch("GET", `/auth/me/activity${query}`);
  if (!res?.ok) return null;
  return (await res.json()) as AuditLogResponse;
}
