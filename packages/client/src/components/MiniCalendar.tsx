import { ChevronLeft, ChevronRight } from "lucide-preact";
import { useMemo, useState } from "preact/hooks";
import { locale } from "../state/prefs.js";

export interface MiniCalendarProps {
  /** Local `YYYY-MM-DD` */
  value: string;
  onChange: (date: string) => void;
}

function toDateParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}

function toISODate(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/**
 * Returns the Monday-index (0 = Monday, 6 = Sunday) of the first cell of the
 * grid so the first displayed week aligns to Monday. Matches the Keep
 * screenshots (and most European locales).
 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function MiniCalendar({ value, onChange }: MiniCalendarProps) {
  const loc = locale.value;
  const selected = toDateParts(value);
  const [cursor, setCursor] = useState({ y: selected.y, m: selected.m });

  const { monthTitle, weekdayLabels, cells } = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = mondayIndex(first);
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const daysInPrev = new Date(cursor.y, cursor.m, 0).getDate();

    const grid: { y: number; m: number; d: number; current: boolean }[] = [];
    for (let i = offset - 1; i >= 0; i--) {
      grid.push({
        y: cursor.m === 0 ? cursor.y - 1 : cursor.y,
        m: cursor.m === 0 ? 11 : cursor.m - 1,
        d: daysInPrev - i,
        current: false,
      });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      grid.push({ y: cursor.y, m: cursor.m, d, current: true });
    }
    while (grid.length % 7 !== 0 || grid.length < 42) {
      const last = grid[grid.length - 1];
      const next = new Date(last.y, last.m, last.d + 1);
      grid.push({
        y: next.getFullYear(),
        m: next.getMonth(),
        d: next.getDate(),
        current: next.getMonth() === cursor.m,
      });
      if (grid.length >= 42) break;
    }

    const title = new Intl.DateTimeFormat(loc, {
      month: "long",
      year: "numeric",
    }).format(first);

    const weekdayFmt = new Intl.DateTimeFormat(loc, { weekday: "short" });
    // Use a known Monday (2026-03-02) to seed the weekday labels.
    const seedMonday = new Date(2026, 2, 2);
    const labels: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(seedMonday);
      d.setDate(seedMonday.getDate() + i);
      labels.push(weekdayFmt.format(d));
    }

    return { monthTitle: title, weekdayLabels: labels, cells: grid };
  }, [cursor.y, cursor.m, loc]);

  const today = new Date();
  const todayISO = toISODate(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const fullDateFmt = useMemo(
    () => new Intl.DateTimeFormat(loc, { dateStyle: "long" }),
    [loc],
  );

  const goto = (delta: number) => {
    setCursor((prev) => {
      const m = prev.m + delta;
      return {
        y: prev.y + Math.floor(m / 12),
        m: ((m % 12) + 12) % 12,
      };
    });
  };

  return (
    <div class="w-64 text-sm">
      <div class="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          class="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          onClick={() => goto(-1)}
          aria-label="Previous month"
        >
          <ChevronLeft class="w-4 h-4" />
        </button>
        <span class="font-medium capitalize">{monthTitle}</span>
        <button
          type="button"
          class="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          onClick={() => goto(1)}
          aria-label="Next month"
        >
          <ChevronRight class="w-4 h-4" />
        </button>
      </div>
      <div class="grid grid-cols-7 text-center text-xs text-neutral-500 dark:text-neutral-400 mb-1">
        {weekdayLabels.map((w) => (
          <div key={w} class="py-1">
            {w}
          </div>
        ))}
      </div>
      <div class="grid grid-cols-7 gap-0.5">
        {cells.map((c) => {
          const iso = toISODate(c.y, c.m, c.d);
          const isSelected = iso === value;
          const isToday = iso === todayISO;
          const cls = [
            "h-8 rounded text-center cursor-pointer transition-colors",
            c.current
              ? "text-neutral-900 dark:text-neutral-100"
              : "text-neutral-400 dark:text-neutral-500",
            isSelected
              ? "bg-blue-600 text-white hover:bg-blue-600"
              : "hover:bg-black/5 dark:hover:bg-white/10",
            isToday && !isSelected ? "ring-1 ring-blue-500 ring-inset" : "",
          ].join(" ");
          return (
            <button
              key={iso}
              type="button"
              class={cls}
              onClick={() => onChange(iso)}
              aria-label={fullDateFmt.format(new Date(c.y, c.m, c.d))}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
            >
              {c.d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
