---
paths:
  - "packages/client/src/state/reminder*.ts"
  - "packages/client/src/sw.ts"
  - "packages/client/src/serviceWorker.ts"
  - "packages/server/src/calendar/**"
---

# Reminders and the Service Worker

Reminders fire from two places and must not double-fire. `state/reminderScheduler.ts` runs timers
in the page; `sw.ts` holds its own copy of the reminder list in IndexedDB and fires via
`periodicSync` (falling back to a poll) so a reminder still arrives with the tab closed. The page
pushes the list down with `sync-reminders` and the worker reports back with `reminder-fired`, which
`serviceWorker.ts` turns into the `lastFiredAt` / next-occurrence write. Dedupe is a 60s window;
catch-up for a missed fire is one hour. `state/reminderTime.ts` owns recurrence maths
(`nextOccurrence`, `snapToFuture`) and is deliberately pure so it tests in the Node project. A reminder
moves only through its `advanceReminder`, `snapReminderToFuture`, `reminderAt` or `pickedReminder`,
never by setting `time` alone: those carry `NoteReminder.day`, without which a month clamped to the
28th becomes the day every later month repeats on. The calendar feed (`calendar/ics.ts` `rruleOf`)
describes the same months.
