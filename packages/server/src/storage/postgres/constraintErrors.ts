/**
 * If Postgres refused a write because a unique constraint or a primary key
 * already holds the value (SQLSTATE 23505). A different constraint failure is
 * a fault, not a taken value. Thus, the caller lets it through.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === "23505";
}
