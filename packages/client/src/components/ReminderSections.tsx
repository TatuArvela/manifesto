import { useEffect, useState } from "preact/hooks";
import { t } from "#/i18n/index.ts";
import {
  type ReminderSection,
  reminderSections,
} from "#/state/reminderSections.ts";
import { boardAnnouncement } from "#/state/ui.ts";
import { sortedNotes } from "#/state/views.ts";
import { boardLabel } from "./boardCard.ts";
import { ReorderableGrid } from "./ReorderableGrid.tsx";

/** How frequently the sections look at the clock again. */
const TICK_MS = 60_000;

const HEADINGS = {
  overdue: "noteGrid.reminders.overdue",
  today: "noteGrid.reminders.today",
  tomorrow: "noteGrid.reminders.tomorrow",
  week: "noteGrid.reminders.week",
  later: "noteGrid.reminders.later",
  past: "noteGrid.reminders.past",
} as const satisfies Record<ReminderSection, string>;

/**
 * The Reminders view: the notes in sections by the time of their reminder
 * (`state/reminderSections.ts`). A note moves to a different section when
 * its reminder fires (the note changes) and when the day changes (the tick).
 */
export function ReminderSections() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const handle = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(handle);
  }, []);

  const sections = reminderSections(sortedNotes.value, now);

  return (
    <div class="mt-4">
      <p class="sr-only" role="status">
        {boardAnnouncement.value}
      </p>
      {sections.map(({ section, notes }, index) => (
        <section key={section} aria-labelledby={`reminders-${section}`}>
          <h2 class={index === 0 ? "mb-2" : "mt-6 mb-2"}>
            <span id={`reminders-${section}`} class={boardLabel}>
              {t(HEADINGS[section])}
            </span>
          </h2>
          <ReorderableGrid
            notes={notes}
            reorderable={false}
            onReorder={() => {}}
          />
        </section>
      ))}
    </div>
  );
}
