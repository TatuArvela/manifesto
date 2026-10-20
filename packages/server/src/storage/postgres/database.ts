import pg from "pg";
import { logger } from "#/lib/logger.ts";

export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

export interface PostgresOpenOptions {
  connectionString: string;
  // Test seam: lets pg-mem inject its own pg-compatible Pool implementation.
  poolFactory?: ((connectionString: string) => PgPool) | undefined;
}

/**
 * How long a request waits for a connection before it fails. Without a limit, a
 * pool with all connections busy, or with no database connection, keeps each
 * request open forever.
 */
const CONNECTION_TIMEOUT_MS = 10_000;

export function openPostgres(opts: PostgresOpenOptions): PgPool {
  const pool = opts.poolFactory
    ? opts.poolFactory(opts.connectionString)
    : new pg.Pool({
        connectionString: opts.connectionString,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      });
  // The pool reports a connection that died while idle (the database restarted,
  // a firewall cut it) as an `error` event. An `error` for which nobody listens
  // ends the process. The pool already dropped that connection, and opens a
  // different one on the next query. Thus, a message is sufficient.
  pool.on("error", (err) => {
    logger.error("Postgres connection lost while idle", {
      error: err.message,
    });
  });
  return pool;
}
