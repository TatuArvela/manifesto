export function nowIso(): string {
  return new Date().toISOString();
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
