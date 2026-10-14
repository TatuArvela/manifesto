/**
 * The rules both drivers' migration runners follow.
 *
 * Until now each driver ran one blob of `CREATE TABLE IF NOT EXISTS`. That
 * builds a correct schema on an empty database and does nothing at all on a
 * populated one, so the *next* change to the schema would have applied on a
 * developer's fresh checkout and silently skipped every deployed instance,
 * leaving a column the code expects missing from the table.
 *
 * A migration is therefore a step with a name, applied once and recorded. The
 * SQL is per-dialect (SQLite has no boolean and no `BYTEA`; Postgres has no
 * `COLLATE NOCASE`), but the ledger, the ordering rules and the names are
 * shared, so a change to one driver's schema that is not made to the other's
 * shows up as a failing test rather than as a difference nobody noticed.
 */

export interface Migration {
  /**
   * Ordered by this, and never renamed once shipped: the name is what a
   * deployed database remembers having run.
   */
  id: string;
  sql: string;
  /**
   * A step that must not run on some databases: when `sql` finds a row, the
   * runner stops with `message` and changes nothing.
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
 * Notes written before encryption are readable where they lie, and changing
 * them in place would leave the old text in the database's free pages and in
 * every backup. So the encrypted version starts on an empty database
 * (`docs/specification/features/encryption.md`, "A server from before
 * encryption"), and this is what a server started on an older one says.
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

/** Where a database records what it has already run. */
export const LEDGER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;

/**
 * The migrations this database has yet to run, in order.
 *
 * Throws rather than guessing when the declared list and the ledger disagree,
 * because each disagreement means someone edited history:
 *
 * - a duplicate id: two steps would collapse into one, and the second would
 *   never run;
 * - an id in the ledger that is no longer declared: a shipped migration was
 *   renamed or deleted, so this database's schema is not one the code knows
 *   how to reason about. Running the rest on top of it would be guesswork.
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
