let lastNowMs = 0;

export function nowIso(): string {
  // Strictly monotonic per process: `updated_at` is the optimistic-concurrency
  // version marker, so two writes in the same millisecond must still produce
  // distinct timestamps or `If-Match` checks silently match the wrong row.
  const ms = Math.max(Date.now(), lastNowMs + 1);
  lastNowMs = ms;
  return new Date(ms).toISOString();
}

export function isoFromDate(date: Date): string {
  return date.toISOString();
}

export function isoPlusDays(days: number, base: Date = new Date()): string {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function isoMinusDays(days: number, base: Date = new Date()): string {
  return isoPlusDays(-days, base);
}
