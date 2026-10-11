import { DataType, newDb } from "pg-mem";
import type { PgPool } from "./database.js";

/**
 * An in-memory stand-in for Postgres, so the driver's tests need no server.
 *
 * pg-mem implements a useful subset, and the gaps show up as "function does
 * not exist" rather than as wrong answers. Where a gap is a function real
 * Postgres has, it is filled in here rather than worked around in the driver:
 * the production SQL should say what it means, and the shim should be the
 * thing that is obviously test-only.
 */
export function newTestPool(): PgPool {
  const db = newDb();

  // Used by the image-count backfill. Postgres has had this since 9.3.
  db.public.registerFunction({
    name: "json_array_length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (raw: string | null) => {
      try {
        const parsed = JSON.parse(raw ?? "[]");
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    },
  });

  // Taken by the migration runner. One process is the only instance there is
  // here, so there is nobody to wait for.
  db.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
    impure: true,
  });

  const { Pool } = db.adapters.createPg();
  // biome-ignore lint/suspicious/noExplicitAny: pg-mem's Pool is structurally compatible with pg.Pool
  return new Pool() as any;
}
