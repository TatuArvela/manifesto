import { awaitsDone, type NoteReminder } from "@manifesto/shared";
import { Bell, BellRing, Check, X } from "lucide-preact";
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
  onDone,
}: {
  reminder: NoteReminder;
  onClick?: (e: MouseEvent) => void;
  onClear?: ((e: MouseEvent) => void) | undefined;
  /** Marks an urgent reminder that fired done. Shown only while it waits. */
  onDone?: (() => void) | undefined;
  anchorRef?: Ref<HTMLButtonElement>;
  /** If the picker that `onClick` opens is open, for `aria-expanded`. */
  expanded?: boolean | undefined;
}) {
  const waiting = awaitsDone(reminder);
  const isPast =
    !waiting &&
    reminder.recurrence === "none" &&
    parseLocalISO(reminder.time).getTime() < Date.now();

  const label = formatLocalDateTime(reminder.time);

  const cls = [
    "inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs rounded-full border",
    // Only its tone tells a reminder that went off from the others. The quiet
    // tone is the palest possible text on a note (`noteText`). An urgent
    // reminder has the full tone in its border and bold words, which read on
    // each note color, where a red would not on a red note.
    reminder.urgent ? "border-current font-semibold" : "border-neutral-400/50",
    isPast ? noteText.quiet : noteText.read,
  ].join(" ");

  const title = reminder.urgent
    ? t("reminder.chipUrgent", { date: label })
    : t("reminder.chip", { date: label });

  const face = (
    <>
      {reminder.urgent ? (
        <BellRing
          class={`w-3 h-3 ${waiting ? "motion-safe:animate-pulse" : ""}`}
          aria-hidden="true"
        />
      ) : (
        <Bell class="w-3 h-3" aria-hidden="true" />
      )}
      <span>{label}</span>
    </>
  );

  const done = onDone && waiting && (
    <button
      type="button"
      class="relative ml-1 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer after:absolute after:-inset-1"
      onClick={(e) => {
        e.stopPropagation();
        onDone();
      }}
      aria-label={t("reminder.done")}
    >
      <Check class="w-3 h-3" />
    </button>
  );

  // Next to the own button of the chip, never inside it. The contents of a
  // button are presentational. Thus, a screen reader did not announce a button
  // nested in the chip, and nested buttons are also invalid HTML.
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
          title={title}
          aria-expanded={expanded}
        >
          {face}
        </button>
        {done}
        {clear}
      </span>
    );
  }

  return (
    <span class={cls} title={title}>
      {face}
      {done}
      {clear}
    </span>
  );
}
