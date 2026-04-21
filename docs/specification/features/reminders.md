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
2. **In-tab `Notification` (fallback while the tab is open).** The page maintains a `setTimeout` per upcoming reminder and fires a native notification directly. Catches missed fires via `visibilitychange` when the tab regains focus (within a one-hour window).
3. **In-app banner (fallback when permission is denied).** The app renders a dismissible banner linking to the note. No OS notification is shown.

Each fire is deduplicated across the two notification paths by:

- Using the note id as the notification `tag` (the OS coalesces same-tag notifications)
- A 60-second `lastFiredAt` window stored on the reminder

## Recurrence

When a recurring reminder fires, the stored `time` is advanced to the next occurrence:

- `daily` — +1 day
- `weekly` — +7 days
- `monthly` — `setMonth(+1)` (clamps to the last day of shorter months)
- `yearly` — `setFullYear(+1)` (Feb 29 on non-leap years falls back to Feb 28)

Arithmetic operates on local components, so a reminder at 08:00 local stays at 08:00 across DST transitions.

## Permission Flow

- Permission is requested only when the user saves their first reminder
- If granted: the service worker is registered (if supported) and Periodic Background Sync is requested with a 15-minute minimum interval
- If denied: the reminder is still saved and will fire via the in-app banner when the tab is open. A one-time toast explains this

## Data Model

See [Data Model — NoteReminder](../data-model.md#notereminder).

## Limitations

- Without a server and Web Push, reminders while the tab is closed depend on the browser waking the service worker. This is best-effort; if the browser is fully closed, reminders queue until the next app open and fire on visibility change
- Reminders are local to the device; they are not synced across devices in open mode
