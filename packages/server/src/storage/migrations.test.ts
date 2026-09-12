import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { type Migration, pendingMigrations } from "./migrations.js";
import {
  MIGRATIONS as PG_MIGRATIONS,
  runMigrations as runPgMigrations,
} from "./postgres/migrations.js";
import { newTestPool } from "./postgres/testDb.js";
import {
  runMigrations as runSqliteMigrations,
  MIGRATIONS as SQLITE_MIGRATIONS,
} from "./sqlite/migrations.js";

/**
 * The bug this closes is a silent one: both drivers used to run a single blob
 * of `CREATE TABLE IF NOT EXISTS`, which builds the right schema on an empty
 * database and does nothing whatsoever on a populated one. The next schema
 * change would have worked on every fresh checkout and reached no deployed
 * instance, so the tests that matter here are the ones that add a second
 * migration to a database that has already been through the first.
 */

const step = (id: string, sql: string): Migration => ({ id, sql });

describe("pendingMigrations", () => {
  const all = [step("0001-a", ""), step("0002-b", ""), step("0003-c", "")];

  it("returns everything for an empty database, in order", () => {
    expect(pendingMigrations(all, []).map((m) => m.id)).toEqual([
      "0001-a",
      "0002-b",
      "0003-c",
    ]);
  });

  it("returns only what has not run", () => {
    expect(
      pendingMigrations(all, ["0001-a", "0002-b"]).map((m) => m.id),
    ).toEqual(["0003-c"]);
  });

  it("refuses a duplicate id, which would swallow the second step", () => {
    expect(() => pendingMigrations([...all, step("0002-b", "")], [])).toThrow(
      /Duplicate migration id: 0002-b/,
    );
  });

  it("refuses to run on a database holding a migration nobody declares", () => {
    // A shipped migration was renamed or deleted. This database's schema is
    // not one the code can reason about, and stacking the rest on top of it
    // would be guesswork.
    expect(() => pendingMigrations(all, ["0001-a", "0000-gone"])).toThrow(
      /no longer declared/,
    );
  });
});

describe("both drivers declare the same migrations", () => {
  it("ships one list of ids, in one order", () => {
    expect(SQLITE_MIGRATIONS.map((m) => m.id)).toEqual(
      PG_MIGRATIONS.map((m) => m.id),
    );
  });
});

describe("sqlite migration runner", () => {
  const open = () => new Database(":memory:");

  it("records what it ran and does nothing the second time", () => {
    const db = open();
    runSqliteMigrations(db);
    const applied = () =>
      (
        db.prepare(`SELECT id FROM schema_migrations`).all() as { id: string }[]
      ).map((row) => row.id);
    expect(applied()).toEqual(SQLITE_MIGRATIONS.map((m) => m.id));

    runSqliteMigrations(db);
    expect(applied()).toEqual(SQLITE_MIGRATIONS.map((m) => m.id));
    db.close();
  });

  it("applies a new migration to a database that already has the old one", () => {
    const db = open();
    runSqliteMigrations(db);

    const withExtra = [
      ...SQLITE_MIGRATIONS,
      step(
        "0002-note-favourite",
        `ALTER TABLE notes ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0`,
      ),
    ];
    runSqliteMigrations(db, withExtra);

    const columns = (
      db.prepare(`PRAGMA table_info(notes)`).all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).toContain("favourite");
    db.close();
  });

  it("leaves neither the schema change nor the ledger row behind when a step fails", () => {
    const db = open();
    runSqliteMigrations(db);

    const broken = [
      ...SQLITE_MIGRATIONS,
      step(
        "0002-broken",
        `ALTER TABLE notes ADD COLUMN ok INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE notes ADD COLUMN ok INTEGER NOT NULL DEFAULT 0;`,
      ),
    ];
    expect(() => runSqliteMigrations(db, broken)).toThrow();

    const columns = (
      db.prepare(`PRAGMA table_info(notes)`).all() as { name: string }[]
    ).map((row) => row.name);
    expect(columns).not.toContain("ok");
    const applied = (
      db.prepare(`SELECT id FROM schema_migrations`).all() as { id: string }[]
    ).map((row) => row.id);
    expect(applied).not.toContain("0002-broken");
    db.close();
  });
});

describe("postgres migration runner", () => {
  const open = newTestPool;

  it("records what it ran and does nothing the second time", async () => {
    const pool = open();
    await runPgMigrations(pool);
    const applied = async () =>
      (await pool.query(`SELECT id FROM schema_migrations`)).rows.map(
        (row: { id: string }) => row.id,
      );
    expect(await applied()).toEqual(PG_MIGRATIONS.map((m) => m.id));

    await runPgMigrations(pool);
    expect(await applied()).toEqual(PG_MIGRATIONS.map((m) => m.id));
  });

  it("applies a new migration to a database that already has the old one", async () => {
    const pool = open();
    await runPgMigrations(pool);

    const withExtra = [
      ...PG_MIGRATIONS,
      step(
        "0002-note-favourite",
        `ALTER TABLE notes ADD COLUMN favourite BOOLEAN NOT NULL DEFAULT FALSE`,
      ),
    ];
    await runPgMigrations(pool, withExtra);

    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'notes'`,
    );
    expect(
      rows.map((row: { column_name: string }) => row.column_name),
    ).toContain("favourite");
  });
});
