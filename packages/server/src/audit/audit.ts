import type { AuditAction } from "@manifesto/shared";
import type { MiddlewareHandler } from "hono";
import { logger } from "#/lib/logger.ts";
import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import { clientAddress } from "#/middleware/rateLimit.ts";
import type { StorageDriver } from "#/storage/types.ts";

/**
 * The audit log: sign-ins and failed sign-ins, changes to the security of an
 * account, admin actions and share changes, each with who, whom and from where.
 * This is for managed deployments, where questions such as "who gave this
 * person admin rights?" and "did a person sign in to this account from a
 * strange place?" need an answer.
 *
 * The record does not wait for the result. If the server cannot write an entry,
 * it logs this, and the request continues. A full disk must not also lock out
 * all persons.
 */

/**
 * The address of each request, set one time by the middleware below. The key is
 * `c.req`, not `c.req.raw`. `bodyLimit` replaces the raw request with a new one
 * when there is a body. When the key was the raw request, each sign-in and
 * admin action lost its address.
 */
const addresses = new WeakMap<object, string>();

export function recordClientAddress(trustProxy: boolean): MiddlewareHandler {
  return async (c, next) => {
    addresses.set(c.req, clientAddress(c, trustProxy));
    await next();
  };
}

export interface AuditInput {
  action: AuditAction;
  actorId?: string | null;
  targetId?: string | null;
  noteId?: string | null;
  detail?: Record<string, string>;
}

export function audit(
  storage: StorageDriver,
  c: { req: object } | null,
  input: AuditInput,
): void {
  const record = {
    id: newId(),
    at: nowIso(),
    action: input.action,
    actorId: input.actorId ?? null,
    targetId: input.targetId ?? null,
    noteId: input.noteId ?? null,
    ip: c ? (addresses.get(c.req) ?? null) : null,
    detail: input.detail ?? {},
  };
  void storage.audit.append(record).catch((err) => {
    logger.warn("Audit entry could not be written", {
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
