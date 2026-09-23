import { AUDIT_ACTIONS, type AuditAction } from "@manifesto/shared";
import { parseJson } from "./noteMapping.js";
import type { AuditListOptions, AuditRecord } from "./types.js";

export interface AuditRow {
  id: string;
  at: string;
  action: string;
  actor_id: string | null;
  target_id: string | null;
  note_id: string | null;
  ip: string | null;
  detail: string;
}

const KNOWN = new Set<string>(AUDIT_ACTIONS);

export function rowToAudit(row: AuditRow): AuditRecord | null {
  // An action a later version recorded and this one does not know is left
  // out rather than mislabelled.
  if (!KNOWN.has(row.action)) return null;
  const detail = parseJson<unknown>(row.detail, {});
  return {
    id: row.id,
    at: row.at,
    action: row.action as AuditAction,
    actorId: row.actor_id,
    targetId: row.target_id,
    noteId: row.note_id,
    ip: row.ip,
    detail:
      detail && typeof detail === "object" && !Array.isArray(detail)
        ? Object.fromEntries(
            Object.entries(detail).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          )
        : {},
  };
}

/** The WHERE clause and its values, with `$n` or `?` placeholders. */
export function auditFilter(
  options: AuditListOptions,
  placeholder: (value: unknown) => string,
): string {
  const clauses: string[] = [];
  if (options.before) clauses.push(`id < ${placeholder(options.before)}`);
  if (options.userId) {
    const p = placeholder(options.userId);
    const q = placeholder(options.userId);
    clauses.push(`(actor_id = ${p} OR target_id = ${q})`);
  }
  if (options.action) clauses.push(`action = ${placeholder(options.action)}`);
  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}
