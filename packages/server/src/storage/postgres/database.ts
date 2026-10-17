import pg from "pg";
import { logger } from "#/lib/logger.js";

export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

export interface PostgresOpenOptions {
  connectionString: string;
  // Test seam: lets pg-mem inject its own pg-compatible Pool implementation.
  poolFactory?: ((connectionString: string) => PgPool) | undefined;
}

/**
 * How long a request waits for a connection before it fails. Without one, a
 * pool with every connection busy or the database unreachable holds each
 * request open for good.
 */
const CONNECTION_TIMEOUT_MS = 10_000;

export function openPostgres(opts: PostgresOpenOptions): PgPool {
  const pool = opts.poolFactory
    ? opts.poolFactory(opts.connectionString)
    : new pg.Pool({
        connectionString: opts.connectionString,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      });
  // The pool reports a connection that died while idle (the database
  // restarted, a firewall cut it) as an `error` event, and an `error` nobody
  // listens for ends the process. The pool has already dropped that
  // connection and opens another on the next query, so saying so is enough.
  pool.on("error", (err) => {
    logger.error("Postgres connection lost while idle", {
      error: err.message,
    });
  });
  return pool;
}
