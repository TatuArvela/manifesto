import { DataType, newDb } from "pg-mem";
import type { PgPool } from "./database.ts";

/**
 * A stand-in for Postgres in memory. Thus, the tests of the driver need no
 * server.
 *
 * pg-mem implements a useful subset. Its gaps show as "function does not
 * exist", not as wrong answers. Where a gap is a function that real Postgres
 * has, this file fills it, and the driver does not work around it. The
 * production SQL must say what it means, and the shim must be clearly only for
 * tests.
 */
export function newTestPool(): PgPool {
  const db = newDb();

  // The image-count backfill uses it. Postgres has had this since 9.3.
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

  // The migration runner takes it. Here, one process is the only instance.
  // Thus, there is nobody to wait for.
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
