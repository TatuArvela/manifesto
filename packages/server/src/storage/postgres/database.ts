import pg from "pg";

export type PgPool = pg.Pool;

export interface PostgresOpenOptions {
  connectionString: string;
  // Test seam: lets pg-mem inject its own pg-compatible Pool implementation.
  poolFactory?: (connectionString: string) => PgPool;
}

export function openPostgres(opts: PostgresOpenOptions): PgPool {
  if (opts.poolFactory) {
    return opts.poolFactory(opts.connectionString);
  }
  return new pg.Pool({ connectionString: opts.connectionString });
}
