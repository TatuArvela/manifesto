import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditLogResponse,
  type ShareUser,
} from "@manifesto/shared";
import type { StorageDriver } from "../storage/types.js";

export interface AuditPageQuery {
  limit?: string;
  before?: string;
  userId?: string;
  action?: string;
}

/**
 * One page of the audit log, newest first: `before` an entry id for older
 * ones, and narrowed to one account (as actor or target) or one action. Actor
 * and target come with their names while the accounts exist.
 *
 * With `viewerId`, the page is that user's own activity: an address is kept
 * only where they acted themselves or nobody was signed in (a failed sign-in
 * on their account). Where someone else acted on them, an admin or a sharer,
 * the entry says who, but not from where.
 */
export async function auditPage(
  storage: StorageDriver,
  query: AuditPageQuery,
  viewerId?: string,
): Promise<AuditLogResponse> {
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const action = (AUDIT_ACTIONS as readonly string[]).includes(
    query.action ?? "",
  )
    ? (query.action as AuditAction)
    : undefined;
  const records = await storage.audit.list({
    limit: limit + 1,
    before: query.before || undefined,
    userId: viewerId ?? (query.userId || undefined),
    action,
  });
  const page = records.slice(0, limit);
  const ids = new Set(
    page.flatMap((r) => [r.actorId, r.targetId]).filter(Boolean) as string[],
  );
  const people = new Map<string, ShareUser>();
  for (const id of ids) {
    const user = await storage.users.findById(id);
    if (user) {
      people.set(id, {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarColor: user.avatarColor,
      });
    }
  }
  const who = (id: string | null) =>
    id === null
      ? null
      : (people.get(id) ?? {
          id,
          username: "",
          displayName: "",
          avatarColor: "",
        });
  return {
    entries: page.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      actor: who(r.actorId),
      target: who(r.targetId),
      noteId: r.noteId,
      ip:
        viewerId === undefined || r.actorId === null || r.actorId === viewerId
          ? r.ip
          : null,
      detail: r.detail,
    })),
    nextBefore: records.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}
