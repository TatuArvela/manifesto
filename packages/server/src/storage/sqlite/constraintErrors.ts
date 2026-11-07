/**
 * If better-sqlite3 refused a write because a UNIQUE or PRIMARY KEY
 * constraint already holds the value. A different constraint failure (NOT
 * NULL, CHECK, FOREIGN KEY) is a fault, not a taken value. Thus, the caller
 * lets it through.
 *
 * With `column`, only a constraint on that column counts. The message names
 * the column (`users.username`). Thus, a unique index that is added later is
 * not taken for this one.
 */
export function isUniqueViolation(err: unknown, column?: string): boolean {
  if (!(err instanceof Error)) return false;
  const { code } = err as { code?: unknown };
  if (
    code !== "SQLITE_CONSTRAINT_UNIQUE" &&
    code !== "SQLITE_CONSTRAINT_PRIMARYKEY"
  ) {
    return false;
  }
  return (
    column === undefined || err.message.toLowerCase().includes(`.${column}`)
  );
}
