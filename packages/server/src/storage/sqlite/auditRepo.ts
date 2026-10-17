import {
  type AuditRow,
  auditFilter,
  rowToAudit,
} from "#/storage/auditMapping.ts";
import type { AuditRecord, AuditRepo } from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

export function createSqliteAuditRepo(db: SqliteDB): AuditRepo {
  const insertStmt = db.prepare(
    `INSERT INTO audit_log (id, at, action, actor_id, target_id, note_id, ip, detail)
     VALUES (@id, @at, @action, @actorId, @targetId, @noteId, @ip, @detail)`,
  );
  const pruneStmt = db.prepare(`DELETE FROM audit_log WHERE at < ?`);
  return {
    async append(record) {
      insertStmt.run({ ...record, detail: JSON.stringify(record.detail) });
    },
    async list(options) {
      const values: unknown[] = [];
      const where = auditFilter(options, (value) => {
        values.push(value);
        return "?";
      });
      const rows = db
        .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`)
        .all(...values, options.limit) as AuditRow[];
      return rows.map(rowToAudit).filter((r): r is AuditRecord => r !== null);
    },
    async deleteBefore(at) {
      return pruneStmt.run(at).changes;
    },
  };
}
