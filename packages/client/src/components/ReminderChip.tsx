import type { NoteReminder } from "@manifesto/shared";
import { Bell, X } from "lucide-preact";
import type { Ref } from "preact";
import { noteText } from "#/colors.ts";
import { t } from "#/i18n/index.ts";
import { locale } from "#/state/prefs.ts";
import { parseLocalISO } from "#/state/reminderScheduler.ts";

function formatLocalDateTime(iso: string): string {
  const d = parseLocalISO(iso);
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function ReminderChip({
  reminder,
  onClick,
  onClear,
  anchorRef,
  expanded,
}: {
  reminder: NoteReminder;
  onClick?: (e: MouseEvent) => void;
  onClear?: ((e: MouseEvent) => void) | undefined;
  anchorRef?: Ref<HTMLButtonElement>;
  /** Whether the picker `onClick` opens is open, for `aria-expanded`. */
  expanded?: boolean | undefined;
}) {
  const isPast =
    reminder.recurrence === "none" &&
    parseLocalISO(reminder.time).getTime() < Date.now();

  const label = formatLocalDateTime(reminder.time);

  const cls = [
    "inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs rounded-full border border-neutral-400/50",
    // A reminder that has gone off is told apart by its tone alone, and the
    // quiet one is as pale as a note's text can go (`noteText`).
    isPast ? noteText.quiet : noteText.read,
  ].join(" ");

  const face = (
    <>
      <Bell class="w-3 h-3" aria-hidden="true" />
      <span>{label}</span>
    </>
  );

  // Beside the chip's own button, never inside it: a button's contents are
  // presentational, so one nested in the chip was not announced, and nesting
  // buttons is invalid HTML besides.
  const clear = onClear && (
    <button
      type="button"
      class="relative ml-1 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer after:absolute after:-inset-1"
      onClick={(e) => {
        e.stopPropagation();
        onClear(e);
      }}
      aria-label={t("reminder.clear")}
    >
      <X class="w-3 h-3" />
    </button>
  );

  if (onClick) {
    return (
      <span class={`${cls} hover:bg-black/5 dark:hover:bg-white/10`}>
        <button
          ref={anchorRef ?? null}
          type="button"
          class="inline-flex items-center gap-1 cursor-pointer rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            onClick(e);
          }}
          title={t("reminder.chip", { date: label })}
          aria-expanded={expanded}
        >
          {face}
        </button>
        {clear}
      </span>
    );
  }

  return (
    <span class={cls} title={t("reminder.chip", { date: label })}>
      {face}
      {clear}
    </span>
  );
}
