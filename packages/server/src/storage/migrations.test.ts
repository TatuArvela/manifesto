import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  type Migration,
  MigrationRefusedError,
  pendingMigrations,
} from "./migrations.ts";
import type { PgPool } from "./postgres/database.ts";
import {
  MIGRATIONS as PG_MIGRATIONS,
  runMigrations as runPgMigrations,
} from "./postgres/migrations.ts";
import { newTestPool } from "./postgres/testDb.ts";
import {
  runMigrations as runSqliteMigrations,
  MIGRATIONS as SQLITE_MIGRATIONS,
} from "./sqlite/migrations.ts";

/**
 * This bug is silent. Both drivers ran one block of `CREATE TABLE IF NOT
 * EXISTS`, which builds the correct schema on an empty database, and does
 * nothing on a database that has data. The next schema change would have worked
 * on each new checkout, and reached no deployed instance. Thus, the important
 * tests here add a second migration to a database that already had the first.
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
    // A shipped migration was renamed or deleted. The code cannot know the
    // schema of this database, and to add the other steps on top of it would be
    // a guess.
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

  // The same ids tell nothing about what each step does. A column added in the
  // step of one driver and forgotten in the step of the other passes all tests
  // that run on the first, and fails in production on the second. Columns by
  // name, not by their types or nullability: the types are different on purpose
  // (`INTEGER` booleans against `BOOLEAN`).
  it("builds the same tables with the same columns", async () => {
    const sqlite = new Database(":memory:");
    runSqliteMigrations(sqlite);
    const lite: Record<string, string[]> = {};
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    for (const { name } of tables) {
      const columns = sqlite.pragma(`table_info(${name})`) as {
        name: string;
      }[];
      lite[name] = columns.map((c) => c.name).sort();
    }

    const pool = newTestPool();
    await runPgMigrations(pool);
    const { rows } = await pool.query<{
      table_name: string;
      column_name: string;
    }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()",
    );
    const pg: Record<string, string[]> = {};
    for (const { table_name, column_name } of rows) {
      pg[table_name] = [...(pg[table_name] ?? []), column_name].sort();
    }

    expect(lite).toEqual(pg);
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

/** Each declared migration up to `id`, but not `id` itself. */
function upTo(migrations: readonly Migration[], id: string): Migration[] {
  const index = migrations.findIndex((m) => m.id === id);
  expect(index).toBeGreaterThan(0);
  return migrations.slice(0, index);
}

const LEGACY_USERS = [
  ["u-late", "zed", "2026-03-01T00:00:00.000Z"],
  ["u-early-b", "bob", "2026-01-01T00:00:00.000Z"],
  ["u-early-a", "amy", "2026-01-01T00:00:00.000Z"],
] as const;

describe("0003-user-admin on a server that already has accounts", () => {
  // A new server makes its first sign-up the admin when it creates it. A server
  // upgraded with existing accounts had no such moment. Thus, the migration
  // must select one. If not, after the upgrade nobody can administer it.
  it("promotes the oldest account on SQLite, and only that one", () => {
    const db = new Database(":memory:");
    runSqliteMigrations(db, upTo(SQLITE_MIGRATIONS, "0003-user-admin"));
    const insert = db.prepare(
      `INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)`,
    );
    for (const row of LEGACY_USERS) insert.run(...row);

    runSqliteMigrations(db);
    const admins = db
      .prepare(`SELECT id FROM users WHERE is_admin = 1`)
      .all() as { id: string }[];
    // The id decides ties on created_at. Thus, the selection is stable.
    expect(admins.map((row) => row.id)).toEqual(["u-early-a"]);
    db.close();
  });

  it("promotes the oldest account on Postgres, and only that one", async () => {
    const pool = newTestPool();
    await runPgMigrations(pool, upTo(PG_MIGRATIONS, "0003-user-admin"));
    for (const row of LEGACY_USERS) {
      await pool.query(
        `INSERT INTO users (id, username, created_at) VALUES ($1, $2, $3)`,
        [...row],
      );
    }

    await runPgMigrations(pool);
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE is_admin = TRUE`,
    );
    expect(rows.map((row: { id: string }) => row.id)).toEqual(["u-early-a"]);
  });
});

describe("the first step of encryption on a database from before it", () => {
  // Notes written before encryption are readable where they are. The server
  // does not seal them in place (the old text would stay in free pages and in
  // all backups). Thus, it does not run next to them, and tells why. This is
  // the first step, not the step that seals the notes. A step before the
  // refusal would have changed the database to which the operator goes back.
  const BEFORE = "0027-account-keys";
  const ENCRYPTION = SQLITE_MIGRATIONS.slice(
    SQLITE_MIGRATIONS.findIndex((m) => m.id === BEFORE),
  ).map((m) => m.id);
  const user = `INSERT INTO users (id, username, created_at) VALUES ('u', 'amy', '2026-01-01')`;
  const note = `INSERT INTO notes (id, user_id, title, content, color, font, created_at, updated_at)
    VALUES ('n', 'u', 'Readable', 'Text', 'default', 'default', '2026-01-01', '2026-01-01')`;

  it("refuses on SQLite, and changes nothing", () => {
    const db = new Database(":memory:");
    runSqliteMigrations(db, upTo(SQLITE_MIGRATIONS, BEFORE));
    db.prepare(user).run();
    db.prepare(note).run();

    expect(() => runSqliteMigrations(db)).toThrow(MigrationRefusedError);
    expect(() => runSqliteMigrations(db)).toThrow(/before end-to-end/);
    const applied = (
      db.prepare(`SELECT id FROM schema_migrations`).all() as { id: string }[]
    ).map((row) => row.id);
    expect(applied.filter((id) => ENCRYPTION.includes(id))).toEqual([]);
    expect(db.prepare(`SELECT title FROM notes WHERE id = 'n'`).get()).toEqual({
      title: "Readable",
    });
    // All that the older version reads is still there.
    expect(db.prepare(`SELECT * FROM totp_recovery_codes`).all()).toEqual([]);
    db.close();
  });

  it("refuses on Postgres, and changes nothing", async () => {
    const pool = newTestPool();
    await runPgMigrations(pool, upTo(PG_MIGRATIONS, BEFORE));
    await pool.query(user);
    await pool.query(note);

    await expect(runPgMigrations(pool)).rejects.toBeInstanceOf(
      MigrationRefusedError,
    );
    const { rows } = await pool.query(`SELECT id FROM schema_migrations`);
    expect(
      rows.filter((row: { id: string }) => ENCRYPTION.includes(row.id)),
    ).toEqual([]);
    expect(
      (await pool.query(`SELECT * FROM totp_recovery_codes`)).rows,
    ).toEqual([]);
  });

  it("runs on a database with accounts and no notes", () => {
    const db = new Database(":memory:");
    runSqliteMigrations(db, upTo(SQLITE_MIGRATIONS, BEFORE));
    db.prepare(user).run();
    db.prepare(
      `INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES ('u', '{"theme":"dark"}', '2026-01-01')`,
    ).run();

    runSqliteMigrations(db);
    // Preferences from before were also readable, and contained names of hidden
    // tags.
    expect(db.prepare(`SELECT * FROM user_prefs`).all()).toEqual([]);
    db.close();
  });
});

describe("0018-api-token-scopes on a server that already has tokens", () => {
  // Scopes limit what a token reaches. Thus, this is the only upgrade that
  // takes something away. The token of a script keeps its notes, and loses the
  // account and sharing routes. The token of a read-only assistant can still
  // only read.
  const columns = `(id, user_id, name, kind, read_only, token_hash, prefix, created_at)`;
  const expected = [
    { id: "t-assistant-ro", scopes: '["notes:read"]' },
    { id: "t-assistant-rw", scopes: '["notes:read","notes:write"]' },
    { id: "t-script", scopes: '["notes:read","notes:write"]' },
  ];

  it("narrows them on SQLite", () => {
    const db = new Database(":memory:");
    runSqliteMigrations(db, upTo(SQLITE_MIGRATIONS, "0018-api-token-scopes"));
    db.prepare(
      `INSERT INTO users (id, username, created_at) VALUES ('u', 'amy', '2026-01-01')`,
    ).run();
    const insert = db.prepare(
      `INSERT INTO api_tokens ${columns} VALUES (?, 'u', 'x', ?, ?, ?, 'p', '2026-01-01')`,
    );
    insert.run("t-script", "api", 0, "h1");
    insert.run("t-assistant-rw", "mcp", 0, "h2");
    insert.run("t-assistant-ro", "mcp", 1, "h3");

    runSqliteMigrations(db);
    expect(
      db.prepare(`SELECT id, scopes FROM api_tokens ORDER BY id`).all(),
    ).toEqual(expected);
    db.close();
  });

  it("narrows them on Postgres", async () => {
    const pool = newTestPool();
    await runPgMigrations(pool, upTo(PG_MIGRATIONS, "0018-api-token-scopes"));
    await pool.query(
      `INSERT INTO users (id, username, created_at) VALUES ('u', 'amy', '2026-01-01')`,
    );
    for (const [id, kind, readOnly, hash] of [
      ["t-script", "api", false, "h1"],
      ["t-assistant-rw", "mcp", false, "h2"],
      ["t-assistant-ro", "mcp", true, "h3"],
    ]) {
      await pool.query(
        `INSERT INTO api_tokens ${columns} VALUES ($1, 'u', 'x', $2, $3, $4, 'p', '2026-01-01')`,
        [id, kind, readOnly, hash],
      );
    }

    await runPgMigrations(pool);
    const { rows } = await pool.query(
      `SELECT id, scopes FROM api_tokens ORDER BY id`,
    );
    expect(rows).toEqual(expected);
  });
});

describe("postgres migration runner", () => {
  const open = newTestPool;

  it("records what it ran and does nothing the second time", async () => {
    const pool = open();
    await runPgMigrations(pool);
    const applied = async () =>
      (
        await pool.query(`SELECT id FROM schema_migrations ORDER BY id`)
      ).rows.map((row: { id: string }) => row.id);
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

  it("skips a step another instance ran after this one read the ledger", async () => {
    const pool = open();
    await runPgMigrations(pool);

    // A second instance that started with the first: its read of the ledger
    // came back empty, and all steps are applied when it gets the lock.
    const asked: string[] = [];
    const late = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (sql: string, params?: unknown[]) => {
            asked.push(sql);
            if (sql === "SELECT id FROM schema_migrations") {
              return Promise.resolve({ rows: [] });
            }
            return client.query(sql, params);
          },
          release: () => client.release(),
        };
      },
    } as unknown as PgPool;
    await runPgMigrations(late);

    expect(asked).toContain("SELECT id FROM schema_migrations");
    expect(asked.filter((sql) => sql.includes("advisory"))).toHaveLength(
      PG_MIGRATIONS.length,
    );
    const { rows } = await pool.query(`SELECT id FROM schema_migrations`);
    expect(rows).toHaveLength(PG_MIGRATIONS.length);
  });
});
