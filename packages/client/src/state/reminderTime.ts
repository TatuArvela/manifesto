import type { ReminderRecurrence } from "@manifesto/shared";

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function parseLocalISO(iso: string): Date {
  const m = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return new Date(iso);
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
}

export function formatLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function nextOccurrence(
  time: string,
  recurrence: ReminderRecurrence,
): string | null {
  if (recurrence === "none") return null;
  const src = parseLocalISO(time);
  const y = src.getFullYear();
  const mo = src.getMonth();
  const d = src.getDate();
  const h = src.getHours();
  const mi = src.getMinutes();
  const s = src.getSeconds();
  let next: Date;
  switch (recurrence) {
    case "daily":
      next = new Date(y, mo, d + 1, h, mi, s);
      break;
    case "weekly":
      next = new Date(y, mo, d + 7, h, mi, s);
      break;
    case "monthly": {
      const targetMonth = mo + 1;
      const lastDay = new Date(y, targetMonth + 1, 0).getDate();
      next = new Date(y, targetMonth, Math.min(d, lastDay), h, mi, s);
      break;
    }
    case "yearly": {
      const lastDay = new Date(y + 1, mo + 1, 0).getDate();
      next = new Date(y + 1, mo, Math.min(d, lastDay), h, mi, s);
      break;
    }
  }
  return formatLocalISO(next);
}

export function snapToFuture(
  time: string,
  recurrence: ReminderRecurrence,
  now: Date = new Date(),
): string {
  if (recurrence === "none") return time;
  let current = time;
  while (parseLocalISO(current).getTime() <= now.getTime()) {
    const advanced = nextOccurrence(current, recurrence);
    if (!advanced) return current;
    current = advanced;
  }
  return current;
}
