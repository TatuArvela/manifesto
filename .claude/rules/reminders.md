---
paths:
  - "packages/client/src/state/reminder*.ts"
  - "packages/client/src/sw.ts"
  - "packages/client/src/serviceWorker.ts"
  - "packages/server/src/calendar/**"
  - "packages/server/src/push/**"
  - "packages/server/src/jobs/pushReminders.ts"
  - "packages/client/src/swPush.ts"
  - "packages/client/src/state/pushSubscription.ts"
  - "packages/shared/src/reminderTime.ts"
---

# Reminders and the Service Worker

Reminders fire from three places and must not double-fire: the page, the service worker, and in
connected mode the server. `state/reminderScheduler.ts` runs timers
in the page; `sw.ts` holds its own copy of the reminder list in IndexedDB and fires via
`periodicSync` (falling back to a poll) so a reminder still arrives with the tab closed. The page
pushes the list down with `sync-reminders` and the worker reports back with `reminder-fired`, which
`serviceWorker.ts` turns into the `lastFiredAt` / next-occurrence write. Dedupe is a 60s window;
catch-up for a missed fire is one hour. `reminderTime.ts` in `@manifesto/shared` (re-exported by `state/reminderTime.ts`) owns recurrence maths
(`nextOccurrence`, `snapToFuture`) and is deliberately pure so it tests in the Node project. A reminder
moves only through its `advanceReminder`, `snapReminderToFuture`, `reminderAt` or `pickedReminder`,
never by setting `time` alone: those carry `NoteReminder.day`, without which a month clamped to the
28th becomes the day every later month repeats on. The calendar feed (`calendar/ics.ts` `rruleOf`)
describes the same months.

The server's part is `jobs/pushReminders.ts`: every 30 seconds, for accounts with a push subscription,
a reminder due for longer than `PUSH_GRACE_MS` that no client has fired is moved on (the same
`advanceReminder`, and `lastFiredAt`) and then sent through `push/sender.ts`. The grace is what keeps
it from racing an open client, which fires on time and writes at once; shorten it and both fire. The
write is conditional on the `updatedAt` the pass read, so of two passes, two processes, or a pass
and a user's edit, the first writer has the reminder and the other sends nothing. The server reads `time` in the reminder's own `timezone` with `instantOf`, never in its own. The worker
handles the message in `swPush.ts` (kept out of `sw.ts` so it tests) and moves its own copy with
`afterPush`, or its next poll fires the occurrence again. `push/webPush.ts` is RFC 8291 and 8292 over
`node:crypto`, held to the RFC's example in its test; a push endpoint is user-supplied, so sends go
through `safeFetch`. A subscription row references its session and dies with it. An untitled note is named
from `UNTITLED` in the job, which repeats the client's `reminder.untitled` for each language the
server writes in: change one and change the other.
