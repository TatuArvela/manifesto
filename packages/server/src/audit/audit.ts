import type { AuditAction } from "@manifesto/shared";
import type { MiddlewareHandler } from "hono";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import { clientAddress } from "../middleware/rateLimit.js";
import type { StorageDriver } from "../storage/types.js";

/**
 * The audit log: sign-ins and failed ones, changes to how an account is
 * secured, admin actions and share changes, each with who, whom and from
 * where. For managed deployments, where "who gave this person admin?" and
 * "was this account signed into from somewhere odd?" need an answer.
 *
 * Recording is fire-and-forget. An entry that cannot be written is logged
 * and the request it describes goes on: a full disk should not also lock
 * everyone out.
 */

/** The address of each request, set once by the middleware below. */
const addresses = new WeakMap<Request, string>();

export function recordClientAddress(trustProxy: boolean): MiddlewareHandler {
  return async (c, next) => {
    addresses.set(c.req.raw, clientAddress(c, trustProxy));
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
  c: { req: { raw: Request } } | null,
  input: AuditInput,
): void {
  const record = {
    id: newId(),
    at: nowIso(),
    action: input.action,
    actorId: input.actorId ?? null,
    targetId: input.targetId ?? null,
    noteId: input.noteId ?? null,
    ip: c ? (addresses.get(c.req.raw) ?? null) : null,
    detail: input.detail ?? {},
  };
  void storage.audit.append(record).catch((err) => {
    logger.warn("Audit entry could not be written", {
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
