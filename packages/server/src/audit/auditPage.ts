import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditLogResponse,
  type ShareUser,
} from "@manifesto/shared";
import type { StorageDriver } from "#/storage/types.ts";

export interface AuditPageQuery {
  limit?: string | undefined;
  before?: string | undefined;
  userId?: string | undefined;
  action?: string | undefined;
}

/**
 * One page of the audit log, newest first. `before` an entry id gives older
 * entries. It can be limited to one account (as actor or target) or one action.
 * The actor and the target come with their names while the accounts exist.
 *
 * With `viewerId`, the page is the own activity of that user. It keeps an
 * address only where they acted themselves, or where nobody was signed in (a
 * failed sign-in on their account). Where a different person acted on them, an
 * admin or a person who shared, the entry tells who, but not from where.
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
