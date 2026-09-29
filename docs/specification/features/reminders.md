# Reminders

Notes can have a scheduled reminder that fires as a device notification at the chosen time, optionally repeating on a recurrence.

## Behavior

- Each note has at most one active reminder
- A reminder is set via the bell button in the note editor toolbar, or the "Remind me" item in the note card's kebab menu
- The picker offers a date, a time, and a recurrence (none, daily, weekly, monthly, yearly)
- A reminder chip on the card surfaces the next fire time; past-due reminders are highlighted
- The sidebar "Reminders" view lists all notes with an active reminder, sorted by next fire time
- Archived notes still fire their reminders; trashed notes do not

## Delivery

Reminders are delivered via three paths, in priority order:

1. **Service worker notification (primary).** When notifications permission is granted, a service worker schedules reminders in IndexedDB and calls `showNotification` when they are due. This path fires even when the tab is closed, subject to the browser waking the service worker (Chromium with Periodic Background Sync is the most reliable; Firefox and Safari are best-effort).
2. **From the open page (fallback while the tab is open).** The page maintains a `setTimeout` per upcoming reminder and shows the notification through its service worker registration, falling back to the page's own `Notification` only where there is no worker. The worker path is what works on phones: Chrome on Android refuses `new Notification()` and an installed iOS app has none. Catches missed fires via `visibilitychange` when the tab regains focus (within a one-hour window).
3. **In-app banner (fallback when permission is denied).** The app renders a dismissible banner linking to the note. No OS notification is shown.

Tapping a notification focuses an open window and opens the note there. With no window open it starts the app at its own scope (not the origin root, so an instance under a subpath works) with `?note=<id>`, which the app opens once and removes from the URL.

Each fire is deduplicated across the two notification paths by:

- Using the note id as the notification `tag` (the OS coalesces same-tag notifications)
- A 60-second `lastFiredAt` window stored on the reminder

## Recurrence

When a recurring reminder fires, the stored `time` is advanced to the next occurrence:

- `daily`: +1 day
- `weekly`: +7 days
- `monthly`: the same day next month, or that month's last day when it is shorter
- `yearly`: the same date next year, with 29 February falling back to the 28th outside a leap year

A shorter month moves one occurrence, not the reminder: each step starts from the day the reminder was
set for, so the 31st goes to 28 February and back to 31 March, and 29 February returns in the next leap
year. While a clamped `time` hides that day, the reminder carries it as `day`; it is dropped again once
`time` shows it. Changing only the hour in the picker keeps it; a new date or recurrence starts over.

Arithmetic operates on local components, so a reminder at 08:00 local stays at 08:00 across DST transitions.

## Permission Flow

- Permission is requested only when the user saves their first reminder
- If granted: the service worker is registered (if supported) and Periodic Background Sync is requested with a 15-minute minimum interval
- If denied: the reminder is still saved and will fire via the in-app banner when the tab is open. A one-time toast explains this

## Data Model

See [Data Model: NoteReminder](../data-model.md#notereminder).

## Calendar Feed

In connected mode, a user's reminders can show in any calendar app that subscribes to a feed (a phone's
calendar, Thunderbird, Google Calendar by URL). In Settings → API tokens, a **Calendar feed** token
gives an address to subscribe to, and a `webcal:` link that opens the device's calendar app with it.

- Each note with a reminder is an event at the reminder's time, in its timezone, repeating daily,
  weekly, monthly or yearly as the reminder does, with an alarm when it is due. A monthly or yearly
  reminder past the 28th repeats on "the last of the 28th to its day" (`BYMONTHDAY` with
  `BYSETPOS=-1`), since `FREQ=MONTHLY` alone skips the months without its date where the app fires
  on their last day. A note in the trash is
  left out. The event is named by the note's title, or its first line when it has none, and holds its
  text.
- The feed is read-only: moving an event in the calendar does not move the reminder.
- The address is the secret. It is shown once, when the token is made, and anyone who has it can read
  the reminders; revoking the token in Settings stops the feed. It opens nothing else, and is not a
  sign-in token anywhere.
- Calendar apps fetch the feed on their own schedule, often every few hours, so a changed reminder can
  take that long to show there. The app's own notifications stay the ones that arrive on time.
- The calendar is named after the token, so two devices can each have their own.

## Limitations

- Without a server and Web Push, reminders while the tab is closed depend on the browser waking the service worker. This is best-effort; if the browser is fully closed, reminders queue until the next app open and fire on visibility change
- Reminders are local to the device; they are not synced across devices in open mode
