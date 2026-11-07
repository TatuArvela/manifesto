import type { ReminderRecurrence } from "@manifesto/shared";
import { ChevronDown, Repeat } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";

const RECURRENCE_KEYS: {
  value: ReminderRecurrence;
  key:
    | "reminder.recurrence.none"
    | "reminder.recurrence.daily"
    | "reminder.recurrence.weekly"
    | "reminder.recurrence.monthly"
    | "reminder.recurrence.yearly";
}[] = [
  { value: "none", key: "reminder.recurrence.none" },
  { value: "daily", key: "reminder.recurrence.daily" },
  { value: "weekly", key: "reminder.recurrence.weekly" },
  { value: "monthly", key: "reminder.recurrence.monthly" },
  { value: "yearly", key: "reminder.recurrence.yearly" },
];

/**
 * The repeat row of the reminder picker, and the list that opens next to it.
 *
 * The list is inside the box of the picker, not a `Dropdown` of its own. The
 * picker is a `Dropdown` in the top layer, and a second `Dropdown` that opens
 * closes all other panels. Thus, the list closes itself, as a `Dropdown` does:
 * Escape (before the picker gets it), a press outside it, or a choice. Focus
 * then goes back to the row.
 */
export function ReminderRepeatMenu({
  value,
  onChange,
}: {
  value: ReminderRecurrence;
  onChange: (value: ReminderRecurrence) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  useEscapeStack(open, close);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node | null)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const label =
    RECURRENCE_KEYS.find((r) => r.value === value)?.key ??
    "reminder.recurrence.none";

  return (
    <div ref={rootRef} class="relative">
      <button
        ref={buttonRef}
        type="button"
        class="flex items-center justify-between w-full px-2 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span class="flex items-center gap-2">
          <Repeat class="w-4 h-4 opacity-70" />
          {t(label)}
        </span>
        <ChevronDown class="w-4 h-4" />
      </button>
      {open && (
        <div class="absolute left-full top-0 ml-2 py-1 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 z-10 min-w-40">
          {RECURRENCE_KEYS.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={value === r.value}
              class={`block w-full px-3 py-1.5 text-sm text-left cursor-pointer ${
                value === r.value
                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
              onClick={() => {
                onChange(r.value);
                close();
              }}
            >
              {t(r.key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
