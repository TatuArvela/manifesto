import type { NoteReminder, ReminderRecurrence } from "@manifesto/shared";
import {
  ArrowLeft,
  Bell,
  Calendar,
  ChevronDown,
  Clock,
  Repeat,
} from "lucide-preact";
import { useMemo, useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import {
  currentTimezone,
  ensureNotificationPermission,
  notifyPermissionDenied,
  parseLocalISO,
  snapToFuture,
} from "../state/reminderScheduler.js";
import { Dropdown } from "./Dropdown.js";
import { Tooltip } from "./Tooltip.js";

interface ReminderPickerProps {
  reminder: NoteReminder | null;
  onChange: (reminder: NoteReminder | null) => void;
  triggerClass: string;
  align?: "left" | "right";
}

interface ReminderPickerPanelProps {
  reminder: NoteReminder | null;
  onChange: (reminder: NoteReminder | null) => void;
  onDone: () => void;
}

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

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function composeISO(date: string, hour: number, minute: number): string {
  return `${date}T${pad(hour)}:${pad(minute)}:00`;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tomorrowAt8(): { date: string; hour: number; minute: number } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return { date: toISODate(d), hour: 8, minute: 0 };
}

function nextMondayAt8(): { date: string; hour: number; minute: number } {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon
  const delta = (1 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return { date: toISODate(d), hour: 8, minute: 0 };
}

function parseInitial(reminder: NoteReminder | null) {
  if (!reminder) {
    const now = new Date();
    now.setHours(8, 0, 0, 0);
    return {
      date: toISODate(now),
      hour: 8,
      minute: 0,
      recurrence: "none" as ReminderRecurrence,
    };
  }
  const d = parseLocalISO(reminder.time);
  return {
    date: toISODate(d),
    hour: d.getHours(),
    minute: d.getMinutes(),
    recurrence: reminder.recurrence,
  };
}

function formatTime(hour: number, minute: number): string {
  return `${hour}.${pad(minute)}`;
}

export function ReminderPickerPanel({
  reminder,
  onChange,
  onDone,
}: ReminderPickerPanelProps) {
  const initial = useMemo(() => parseInitial(reminder), [reminder]);

  const [view, setView] = useState<"quick" | "custom">("quick");
  const [date, setDate] = useState(initial.date);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [recurrence, setRecurrence] = useState<ReminderRecurrence>(
    initial.recurrence,
  );
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [triedSave, setTriedSave] = useState(false);

  const chosenISO = composeISO(date, hour, minute);
  const isPast = parseLocalISO(chosenISO).getTime() <= Date.now();
  const savable = recurrence !== "none" || !isPast;

  const commit = async (
    nextDate: string,
    nextHour: number,
    nextMinute: number,
    nextRecurrence: ReminderRecurrence,
  ) => {
    let finalISO = composeISO(nextDate, nextHour, nextMinute);
    const past = parseLocalISO(finalISO).getTime() <= Date.now();
    if (nextRecurrence !== "none" && past) {
      finalISO = snapToFuture(finalISO, nextRecurrence);
    }
    const perm = await ensureNotificationPermission();
    if (perm === "denied") notifyPermissionDenied();
    onChange({
      time: finalISO,
      recurrence: nextRecurrence,
      timezone: currentTimezone(),
    });
    onDone();
  };

  const saveCustom = () => {
    if (!savable) {
      setTriedSave(true);
      return;
    }
    commit(date, hour, minute, recurrence);
  };

  const saveTomorrow = () => {
    const { date: d, hour: h, minute: m } = tomorrowAt8();
    commit(d, h, m, "none");
  };

  const saveNextWeek = () => {
    const { date: d, hour: h, minute: m } = nextMondayAt8();
    commit(d, h, m, "none");
  };

  const handleClear = () => {
    onChange(null);
    onDone();
  };

  if (view === "quick") {
    const tomorrow = tomorrowAt8();
    const nextWeek = nextMondayAt8();
    const rowClass =
      "flex items-center justify-between w-full px-3 py-2 text-sm rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer";
    return (
      <div class="flex flex-col gap-1 min-w-56">
        <div class="px-3 pt-1 pb-2 text-sm font-medium select-none">
          {t("reminder.header")}
        </div>
        <button type="button" class={rowClass} onClick={saveTomorrow}>
          <span>{t("reminder.tomorrow")}</span>
          <span class="text-gray-500 dark:text-gray-400 text-xs">
            {t("reminder.tomorrowAt", {
              time: formatTime(tomorrow.hour, tomorrow.minute),
            })}
          </span>
        </button>
        <button type="button" class={rowClass} onClick={saveNextWeek}>
          <span>{t("reminder.nextWeek")}</span>
          <span class="text-gray-500 dark:text-gray-400 text-xs">
            {t("reminder.nextWeekAt", {
              time: formatTime(nextWeek.hour, nextWeek.minute),
            })}
          </span>
        </button>
        <button
          type="button"
          class={`${rowClass} gap-2 justify-start`}
          onClick={() => setView("custom")}
        >
          <Calendar class="w-4 h-4 opacity-70" />
          <span>{t("reminder.pickDate")}</span>
        </button>
        {reminder && (
          <>
            <div class="my-1 border-t border-gray-200 dark:border-gray-700" />
            <button
              type="button"
              class={`${rowClass} text-red-600 dark:text-red-400`}
              onClick={handleClear}
            >
              {t("reminder.clear")}
            </button>
          </>
        )}
      </div>
    );
  }

  const recurrenceLabel =
    RECURRENCE_KEYS.find((r) => r.value === recurrence)?.key ??
    "reminder.recurrence.none";

  const fieldClass =
    "flex items-center gap-2 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 focus-within:bg-black/5 dark:focus-within:bg-white/10";

  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2 px-1 pb-1">
        <button
          type="button"
          class="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          onClick={() => setView("quick")}
          aria-label={t("reminder.back")}
        >
          <ArrowLeft class="w-4 h-4" />
        </button>
        <Calendar class="w-4 h-4 opacity-70" />
        <span class="text-sm font-medium select-none">
          {t("reminder.pickDate")}
        </span>
      </div>

      <div class={fieldClass}>
        <Calendar class="w-4 h-4 opacity-70 shrink-0" />
        <input
          type="date"
          class="flex-1 min-w-0 bg-transparent text-sm outline-none dark:[color-scheme:dark]"
          value={date}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (v) setDate(v);
          }}
        />
      </div>

      <div class={fieldClass}>
        <Clock class="w-4 h-4 opacity-70 shrink-0" />
        <input
          type="time"
          class="flex-1 min-w-0 bg-transparent text-sm outline-none dark:[color-scheme:dark]"
          value={`${pad(hour)}:${pad(minute)}`}
          onInput={(e) => {
            const [h, m] = (e.target as HTMLInputElement).value
              .split(":")
              .map(Number);
            if (!Number.isNaN(h) && !Number.isNaN(m)) {
              setHour(h);
              setMinute(m);
            }
          }}
        />
      </div>

      <div class="relative">
        <button
          type="button"
          class="flex items-center justify-between w-full px-2 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          onClick={() => setRepeatOpen(!repeatOpen)}
          aria-expanded={repeatOpen}
        >
          <span class="flex items-center gap-2">
            <Repeat class="w-4 h-4 opacity-70" />
            {t(recurrenceLabel)}
          </span>
          <ChevronDown class="w-4 h-4" />
        </button>
        {repeatOpen && (
          <>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
            <div
              class="fixed inset-0 z-10"
              role="presentation"
              onClick={() => setRepeatOpen(false)}
              onKeyDown={() => {}}
            />
            <div class="absolute left-full top-0 ml-2 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-40">
              {RECURRENCE_KEYS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  class={`block w-full px-3 py-1.5 text-sm text-left cursor-pointer ${
                    recurrence === r.value
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                      : "hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                  onClick={() => {
                    setRecurrence(r.value);
                    setRepeatOpen(false);
                  }}
                >
                  {t(r.key)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {triedSave && !savable && (
        <div class="text-xs text-red-600 dark:text-red-400 px-2 pt-1">
          {t("reminder.pastHelp")}
        </div>
      )}

      <div class="flex gap-1 justify-end items-center pt-1">
        {reminder && (
          <button
            type="button"
            class="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            onClick={handleClear}
          >
            {t("reminder.clear")}
          </button>
        )}
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium rounded cursor-pointer bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600"
          onClick={saveCustom}
        >
          {t("reminder.save")}
        </button>
      </div>
    </div>
  );
}

export function ReminderPicker({
  reminder,
  onChange,
  triggerClass,
  align = "left",
}: ReminderPickerProps) {
  const [open, setOpen] = useState(false);

  const panelClass =
    "p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-72";

  const label = reminder ? t("reminder.edit") : t("reminder.set");

  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      placement={align === "right" ? "top-end" : "top-start"}
      panelClass={panelClass}
      trigger={
        <Tooltip label={label}>
          <button
            type="button"
            class={triggerClass}
            onClick={() => setOpen(!open)}
            aria-label={label}
          >
            <Bell class="w-4 h-4" />
          </button>
        </Tooltip>
      }
    >
      {open && (
        <ReminderPickerPanel
          reminder={reminder}
          onChange={onChange}
          onDone={() => setOpen(false)}
        />
      )}
    </Dropdown>
  );
}
