---
paths:
  - "packages/client/src/state/reminder*.ts"
  - "packages/client/src/sw.ts"
  - "packages/client/src/serviceWorker.ts"
  - "packages/server/src/calendar/**"
  - "packages/server/src/push/**"
  - "packages/server/src/jobs/pushReminders.ts"
  - "packages/client/src/swPush.ts"
  - "packages/client/src/swReminders.ts"
  - "packages/client/src/state/pushSubscription.ts"
  - "packages/shared/src/reminderTime.ts"
  - "packages/client/src/utils/reminderNotification.ts"
---

# Reminders and the Service Worker

A reminder can fire from three places: the page, the service worker, and (in connected mode) the
server. It must not fire twice.

## Page and service worker

- `state/reminderScheduler.ts` runs timers in the page.
- `sw.ts` keeps its own copy of the reminder list in IndexedDB. It fires through `periodicSync`,
  or through a poll if `periodicSync` is not available. Thus, a reminder arrives when the tab is
  closed.
- `swReminders.ts` decides what the worker does with each stored reminder: wait, fire, or skip a
  reminder that it missed a long time ago. This code is not in `sw.ts`, because `sw.ts` runs Workbox
  when it loads, and that prevents tests.
- The page sends the list to the worker with `sync-reminders`. The worker replies with
  `reminder-fired`. `serviceWorker.ts` changes that reply into the write of `lastFiredAt` and the
  next occurrence.
- The dedupe window is 60s. The catch-up time for a missed fire is one hour.

`reminderTime.ts` in `@manifesto/shared` owns the recurrence calculations (`nextOccurrence`,
`snapToFuture`). It is pure on purpose, so that it can run in the Node test project.

A reminder moves only through `advanceReminder`, `snapReminderToFuture`, `reminderAt` or
`pickedReminder`. Never set `time` alone. These functions keep `NoteReminder.day`. Without it, a
month that the code clamps to the 28th makes the 28th the day for all of the subsequent months. The
calendar feed (`rruleOf` in `calendar/ics.ts`) gives the same months.

## Urgent reminders

An urgent reminder (`NoteReminder.urgent`) does not move on when it fires. The three places agree
through the shared functions in `reminderTime.ts`. Never test `recurrence === "none" &&
lastFiredAt` again by hand.

- `nextFireAt` tells when a reminder fires next: its time, `lastFiredAt + URGENT_REPEAT_MS` for an
  urgent reminder that waits (`awaitsDone`), or null.
- `afterFire` is the write after a fire, for all three places. `reminderDone` is the write of
  "Done".
- The one-hour catch-up limit does not apply to an urgent reminder.
- The notification options are in `utils/reminderNotification.ts`, because the page and the worker
  both show one. The worker has no catalogue. Thus, the page sends the "Done" label in each urgent
  item of `sync-reminders` (`doneLabel`).
- "Done" on a notification goes to a page as `reminder-done`, or starts the app with
  `?reminderDone=<id>` (`useNoteFromReminder`, `markReminderDoneWhenLoaded`).

## Server

The server part is `jobs/pushReminders.ts`. Each 30 seconds, it examines the accounts that have a
push subscription. For each reminder that is due for longer than `PUSH_GRACE_MS`, and that no client
fired, it does these steps:

1. It moves the reminder on (the same `afterFire`, which sets `lastFiredAt`).
2. It sends the reminder through `push/sender.ts`.

The grace time prevents a race with an open client. An open client fires on time and writes
immediately. If you make the grace time shorter, both fire. The write has a condition on the
`updatedAt` that the pass read. Thus, if two passes, two processes, or a pass and a user edit occur
together, the first writer gets the reminder, and the other sends nothing. The server reads `time`
in the `timezone` of the reminder with `instantOf`, never in its own timezone.

The worker receives the message in `swPush.ts`. This code is not in `sw.ts`, so that it can have
tests. The worker moves its own copy with `afterPush`. If it does not, its next poll fires the
occurrence again.

`push/webPush.ts` implements RFC 8291 and RFC 8292 with `node:crypto`. Its test compares it to the
example in the RFC. The user supplies the push endpoint. Thus, sends go through `safeFetch`.

A subscription row references its session, and the server deletes the row with the session. A
subscription from a browser that the account did not have before gets the `push.subscribed` audit
entry. A renewal does not.

The job names an untitled note from `UNTITLED`. `UNTITLED` repeats the `reminder.untitled` string of
the client, for each language that the server writes. If you change one, change the other.
