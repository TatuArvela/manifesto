/**
 * The rules both drivers' migration runners follow.
 *
 * Until now each driver ran one blob of `CREATE TABLE IF NOT EXISTS`. That
 * builds a correct schema on an empty database and does nothing at all on a
 * populated one — so the *next* change to the schema would have applied on a
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
}

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
        `Database has migration ${id} applied, but it is no longer declared — ` +
          `a shipped migration must never be renamed or removed`,
      );
    }
  }
  const appliedSet = new Set(applied);
  return declared.filter((migration) => !appliedSet.has(migration.id));
}
