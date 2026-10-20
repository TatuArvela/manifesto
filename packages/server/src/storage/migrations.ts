/**
 * The rules that the migration runners of both drivers follow.
 *
 * Before, each driver ran one block of `CREATE TABLE IF NOT EXISTS`. That
 * builds a correct schema on an empty database, and does nothing on a database
 * that has data. Thus, the *next* schema change would have applied on the new
 * checkout of a developer, and silently skipped all deployed instances. A
 * column that the code needs would then be missing from the table.
 *
 * Thus, a migration is a step with a name, applied one time and recorded. The
 * SQL is different for each dialect (SQLite has no boolean and no `BYTEA`;
 * Postgres has no `COLLATE NOCASE`). But the ledger, the order rules and the
 * names are shared. Thus, a schema change in one driver that is not in the
 * other shows as a failing test, not as a difference that nobody saw.
 */

export interface Migration {
  /**
   * The order uses this. Never rename it after it ships: a deployed database
   * remembers the name of each step that it ran.
   */
  id: string;
  sql: string;
  /**
   * A step that must not run on some databases. When `sql` finds a row, the
   * runner stops with `message`, and changes nothing.
   */
  refuseIf?: { sql: string; message: string };
}

/** What a refused step throws, for the start-up code to print as it is. */
export class MigrationRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationRefusedError";
  }
}

/**
 * Notes written before encryption are readable where they are. A change in
 * place would leave the old text in the free pages of the database and in all
 * backups. Thus, the encrypted version starts on an empty database
 * (`docs/specification/features/encryption.md`, "A server from before
 * encryption"). This is what a server says when it starts on an older database.
 */
export const BEFORE_ENCRYPTION = {
  sql: "SELECT 1 FROM notes LIMIT 1",
  message:
    "This database holds notes from before end-to-end encryption, and this " +
    "version of the server does not upgrade them in place. Start it on an " +
    "empty database: each person exports their notes from Settings on the " +
    "older version and imports them here. See " +
    "docs/specification/features/encryption.md.",
};

/** Where a database records the steps that it already ran. */
export const LEDGER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;

/**
 * The migrations that this database must still run, in order.
 *
 * It throws, and does not guess, when the declared list and the ledger do not
 * agree. Each difference means that a person edited the history:
 *
 * - A duplicate id: two steps would become one, and the second would never run.
 * - An id in the ledger that is not declared now: a shipped migration was
 *   renamed or deleted. Thus, the code cannot know the schema of this database.
 *   To run the other steps on top of it would be a guess.
 */
export function pendingMigrations(
  declared: readonly Migration[],
  applied: readonly string[],
): Migration[] {
  const seen = new Set<string>();
  for (const migration of declared) {
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    seen.add(migration.id);
  }
  for (const id of applied) {
    if (!seen.has(id)) {
      throw new Error(
        `Database has migration ${id} applied, but it is no longer declared; ` +
          `a shipped migration must never be renamed or removed`,
      );
    }
  }
  const appliedSet = new Set(applied);
  return declared.filter((migration) => !appliedSet.has(migration.id));
}
