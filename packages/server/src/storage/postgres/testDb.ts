import { EventEmitter } from "node:events";
import { PGlite, types as pgliteTypes } from "@electric-sql/pglite";
import pg from "pg";
import type { PgPool } from "./database.ts";
import { runMigrations } from "./migrations.ts";

/**
 * Real Postgres in memory (PGlite, Postgres compiled to WebAssembly). Thus, the
 * tests of the driver need no server, and they run the production SQL on the
 * same engine as production.
 *
 * A PGlite instance takes more than a second to start. Thus, all pools of a
 * test file share one instance, and each pool works in a schema, which its
 * `search_path` selects. The instance starts when a test file imports this
 * module, not in the first test, which would otherwise pass its time limit
 * when all workers run.
 *
 * PGlite has one connection. Thus, each pool is a `pg.Pool` with `max: 1`, and
 * all pools of a file take turns on the one connection. `connect()` waits until
 * the client before it is released, and `query()` waits for its turn. Two
 * transactions never mix in one session. A query on the pool while the code
 * holds a client waits forever, as it does in production when all connections
 * are busy. The test then times out.
 *
 * Values go in and come out through the converters of `pg`, not those of
 * PGlite. Thus, a `BIGINT` is a string and a `TIMESTAMPTZ` is a `Date`, as in
 * production.
 */
const db = await PGlite.create();

let schemas = 0;

/** A pool over a new, empty schema, for the tests of the migrations. */
export function newTestPool(): PgPool {
  schemas += 1;
  return poolIn(`pool_${schemas}`, { dropOnEnd: true });
}

const MIGRATED_SCHEMA = "migrated";
let migrated = false;

/**
 * A pool over a schema with all migrations, and no rows. All calls in a file
 * share the schema: the first call migrates it, and each call after that
 * empties its tables. Migrations take more than 100 ms, and an empty takes a
 * few. The tests in a file run one after the other. Thus, the pool of the test
 * before is not in use any more.
 */
export async function newMigratedTestPool(): Promise<PgPool> {
  const pool = poolIn(MIGRATED_SCHEMA, { dropOnEnd: false });
  if (migrated) {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'`,
    );
    const tables = rows.map((row) => `"${row.tablename}"`).join(", ");
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  } else {
    await runMigrations(pool);
    migrated = true;
  }
  return pool;
}

// `pg` exports it, but `@types/pg` does not declare it.
const { prepareValue } = (
  pg as unknown as { utils: { prepareValue(value: unknown): unknown } }
).utils;

// No type has the oid 0. Thus, `pg` gives its parser that keeps the text.
const NO_PARSE = pg.types.getTypeParser(0 as number, "text");

/**
 * The parser of `pg` for each type that `pg` or PGlite knows. A type that
 * neither knows stays text in both.
 */
const PARSERS = Object.fromEntries(
  [
    ...Array.from({ length: 4096 }, (_, oid) => oid).filter(
      (oid) => pg.types.getTypeParser(oid, "text") !== NO_PARSE,
    ),
    ...Object.keys(pgliteTypes.parsers).map(Number),
  ].map((oid) => [oid, pg.types.getTypeParser(oid, "text")]),
);

/**
 * `prepareValue` already made each parameter into the text (or the bytes) that
 * `pg` sends. Thus, PGlite must send it without a change.
 */
const AS_PREPARED = new Proxy(
  {},
  { get: () => (value: unknown) => value },
) as Record<number, (value: unknown) => string>;

const OPTIONS = { parsers: PARSERS, serializers: AS_PREPARED };

type Values = unknown[] | undefined;

async function run(text: string, values: Values) {
  // As `pg`: a query without parameters goes as a simple query, which can
  // contain more than one statement. The result is that of the last one.
  const result =
    values && values.length > 0
      ? await db.query(text, values.map(prepareValue), OPTIONS)
      : (await db.exec(text, OPTIONS)).at(-1);
  return {
    rows: result?.rows ?? [],
    rowCount: result?.rowCount ?? null,
    command: result?.command ?? "",
    fields: result?.fields ?? [],
    oid: 0,
  };
}

let turn: Promise<void> = Promise.resolve();
let currentSchema: string | null = null;

/** Waits for the connection, and gives the function that releases it. */
async function take(): Promise<() => void> {
  let release = () => {};
  const previous = turn;
  turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

function poolIn(schema: string, { dropOnEnd }: { dropOnEnd: boolean }) {
  let ended = false;

  /** Takes the connection, and points it at the schema of this pool. */
  async function takeOwn(): Promise<() => void> {
    if (ended) throw new Error("The pool has ended");
    const release = await take();
    try {
      if (currentSchema !== schema) {
        await db.exec(
          `CREATE SCHEMA IF NOT EXISTS ${schema}; SET search_path TO ${schema}`,
        );
        currentSchema = schema;
      }
      return release;
    } catch (err) {
      release();
      throw err;
    }
  }

  const pool = Object.assign(new EventEmitter(), {
    async query(text: string, values?: Values) {
      const release = await takeOwn();
      try {
        return await run(text, values);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await takeOwn();
      let released = false;
      return {
        query(text: string, values?: Values) {
          if (released) {
            return Promise.reject(new Error("The client was released"));
          }
          return run(text, values);
        },
        release() {
          if (released) return;
          released = true;
          release();
        },
      };
    },
    async end() {
      const release = await takeOwn();
      ended = true;
      try {
        if (dropOnEnd) {
          await db.exec(`DROP SCHEMA ${schema} CASCADE`);
          currentSchema = null;
        }
      } finally {
        release();
      }
    },
  });
  return pool as unknown as PgPool;
}
