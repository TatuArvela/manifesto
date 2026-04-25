// Pure functions exposed to plugins inside the sandbox. Each must be fully
// self-contained — no closures over module scope, no imports — so they can be
// Function.prototype.toString()'d into the iframe bootstrap as a prelude.
//
// Host code (tests, potentially UI helpers) can also call these directly.

/**
 * Localized labels for `approxUntil`. Every string may include `{n}` as a
 * placeholder for a number; plain labels (today/tomorrow/…) have none. The
 * host builds this dict from i18n and passes it into the sandbox so stdlib
 * stays free of hardcoded strings.
 */
export interface ApproxLabels {
  today: string;
  tomorrow: string;
  dayAfterTomorrow: string;
  yesterday: string;
  inNDays: string;
  inAWeek: string;
  inNWeeks: string;
  underNWeeks: string;
  inAMonth: string;
  nDaysAgo: string;
  aWeekAgo: string;
  nWeeksAgo: string;
  underNWeeksAgo: string;
  aMonthAgo: string;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(aIso: string, bIso: string): number {
  const MS = 24 * 60 * 60 * 1000;
  const a = new Date(aIso).setUTCHours(0, 0, 0, 0);
  const b = new Date(bIso).setUTCHours(0, 0, 0, 0);
  return Math.round((b - a) / MS);
}

export function firstFuture(list: string[], nowIso: string): string | null {
  const nowMs = new Date(nowIso).getTime();
  let best: string | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  for (const iso of list) {
    const ms = new Date(iso).getTime();
    if (ms > nowMs && ms < bestMs) {
      best = iso;
      bestMs = ms;
    }
  }
  return best;
}

export function lastPast(list: string[], nowIso: string): string | null {
  const nowMs = new Date(nowIso).getTime();
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const iso of list) {
    const ms = new Date(iso).getTime();
    if (ms <= nowMs && ms > bestMs) {
      best = iso;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Project a recurring event forward from a known occurrence. Returns the most
 * recent occurrence on or before `nowIso`.
 */
export function lastOccurrence(
  startIso: string,
  intervalDays: number,
  nowIso: string,
): string {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
    throw new RangeError("intervalDays must be a positive finite number");
  }
  const MS = 24 * 60 * 60 * 1000;
  const start = new Date(startIso).setUTCHours(0, 0, 0, 0);
  const now = new Date(nowIso).setUTCHours(0, 0, 0, 0);
  const diffDays = Math.floor((now - start) / MS);
  const steps = Math.floor(diffDays / intervalDays);
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + steps * intervalDays);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
}

export function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Localized "N days ago" / "in N days". Uses Intl.RelativeTimeFormat with
 * numeric: "auto" so same-day returns "today" / "tänään".
 */
export function relativeDays(
  iso: string,
  nowIso: string,
  locale: string,
): string {
  const MS = 24 * 60 * 60 * 1000;
  const a = new Date(iso).setUTCHours(0, 0, 0, 0);
  const b = new Date(nowIso).setUTCHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / MS);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return rtf.format(diff, "day");
}

/**
 * Bucketed approximation for "soon-ish" events. Picks the narrowest bucket
 * that matches: today / tomorrow / day-after / N days / N weeks on exact
 * multiples of 7 / a month at 30-31 / "less than N weeks" otherwise. Falls
 * back to an absolute locale-formatted date past 6 weeks.
 */
export function approxUntil(
  iso: string,
  nowIso: string,
  locale: string,
  labels: ApproxLabels,
): string {
  const MS = 24 * 60 * 60 * 1000;
  const a = new Date(iso).setUTCHours(0, 0, 0, 0);
  const b = new Date(nowIso).setUTCHours(0, 0, 0, 0);
  const days = Math.round((a - b) / MS);
  const abs = Math.abs(days);
  const fill = (t: string, n: number) => t.replace(/\{n\}/g, String(n));

  if (days === 0) return labels.today;
  if (days === 1) return labels.tomorrow;
  if (days === 2) return labels.dayAfterTomorrow;
  if (days === -1) return labels.yesterday;

  if (days > 0) {
    if (days <= 6) return fill(labels.inNDays, days);
    if (days === 30 || days === 31) return labels.inAMonth;
    if (days === 7) return labels.inAWeek;
    if (days <= 42 && days % 7 === 0) return fill(labels.inNWeeks, days / 7);
    if (days < 42) return fill(labels.underNWeeks, Math.ceil(days / 7));
  } else {
    if (abs <= 6) return fill(labels.nDaysAgo, abs);
    if (abs === 30 || abs === 31) return labels.aMonthAgo;
    if (abs === 7) return labels.aWeekAgo;
    if (abs <= 42 && abs % 7 === 0) return fill(labels.nWeeksAgo, abs / 7);
    if (abs < 42) return fill(labels.underNWeeksAgo, Math.ceil(abs / 7));
  }

  return new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
}

export const STDLIB_FUNCTIONS = {
  addDays,
  daysBetween,
  firstFuture,
  lastPast,
  lastOccurrence,
  formatDate,
  formatDateTime,
  relativeDays,
  approxUntil,
} as const;

export type StdlibName = keyof typeof STDLIB_FUNCTIONS;

/**
 * Serialize the stdlib into a JS source string that, when evaluated inside
 * the sandbox, populates a `__stdlib` object with locale pre-bound. The
 * sandbox's bootstrap wraps this and exposes it as `ctx.stdlib`.
 */
export function buildStdlibPrelude(): string {
  const parts: string[] = [];
  for (const [name, fn] of Object.entries(STDLIB_FUNCTIONS)) {
    parts.push(`${name}: ${fn.toString()}`);
  }
  return `const __stdlibRaw = { ${parts.join(",\n")} };`;
}
