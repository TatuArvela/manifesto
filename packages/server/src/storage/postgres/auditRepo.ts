import { type AuditRow, auditFilter, rowToAudit } from "../auditMapping.js";
import type { AuditRecord, AuditRepo } from "../types.js";
import type { PgPool } from "./database.js";

export function createPostgresAuditRepo(pool: PgPool): AuditRepo {
  return {
    async append(record) {
      await pool.query(
        `INSERT INTO audit_log (id, at, action, actor_id, target_id, note_id, ip, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          record.id,
          record.at,
          record.action,
          record.actorId,
          record.targetId,
          record.noteId,
          record.ip,
          JSON.stringify(record.detail),
        ],
      );
    },
    async list(options) {
      const values: unknown[] = [];
      const where = auditFilter(options, (value) => {
        values.push(value);
        return `$${values.length}`;
      });
      values.push(options.limit);
      const result = await pool.query<AuditRow>(
        `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows
        .map(rowToAudit)
        .filter((r): r is AuditRecord => r !== null);
    },
    async deleteBefore(at) {
      const result = await pool.query(`DELETE FROM audit_log WHERE at < $1`, [
        at,
      ]);
      return result.rowCount ?? 0;
    },
  };
}
