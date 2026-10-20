let lastNowMs = 0;

export function nowIso(): string {
  // Strictly monotonic for each process. `updated_at` is the version marker for
  // optimistic concurrency. Thus, two writes in the same millisecond must still
  // make different timestamps. If not, `If-Match` checks silently match the
  // wrong row.
  const ms = Math.max(Date.now(), lastNowMs + 1);
  lastNowMs = ms;
  return new Date(ms).toISOString();
}

export function isoPlusDays(days: number, base: Date = new Date()): string {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function isoMinusDays(days: number, base: Date = new Date()): string {
  return isoPlusDays(-days, base);
}
