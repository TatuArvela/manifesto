# Reminders

A note can have a scheduled reminder. The reminder fires as a device notification at the selected
time. It can repeat on a recurrence.

## Behavior

- Each note has a maximum of one active reminder.
- To set a reminder, use the bell button. It is the second button (after the color) on the toolbar of
  the note editor and on the toolbar of the card. On a card that has a reminder, you can also use the
  chip of the reminder.
- The picker has a date, a time, a recurrence (none, daily, weekly, monthly, yearly), and an
  "Urgent" switch (see [Urgent reminders](#urgent-reminders)).
- A reminder chip on the card shows the next fire time. Reminders that are past due are highlighted.
  The chip of an urgent reminder has a bold border and a ringing bell.
- The "Reminders" view in the sidebar lists all notes with an active reminder in sections: Overdue,
  Today, Tomorrow, Next 7 days, Later, and Fired (one-time reminders that fired). In each section,
  urgent reminders come first, then the next fire time. An urgent reminder that waits for "Done" is
  in Overdue. The sections follow the clock of the device, and the view looks at it again each
  minute.
- Archived notes still fire their reminders. Trashed notes do not.

## Urgent reminders

An urgent reminder is for something that the user must not miss.

- Its notification stays on the screen until the user acts on it (`requireInteraction`). It has a
  "Done" button.
- When it fires, it does not move on to its next occurrence. It stays at its time (with a pulsing
  bell on its chip), and fires again each 5 minutes (`URGENT_REPEAT_MS`).
- "Done" stops it. A repeating reminder goes to its next occurrence after now. A one-time reminder
  goes away. "Done" is on the notification, on the chip, in the picker and on the in-app banner.
- An urgent reminder is never too old to fire. The one-hour catch-up limit does not apply to it.
- If the user switches "Urgent" off while it waits, a repeating reminder goes to its next
  occurrence, and a one-time reminder stays as one that fired.
- The calendar feed gives it `PRIORITY:1`.

The "Done" button of a notification works also when no window is open. The service worker stops its
own copy at once. Only a page can write the note, so the worker opens the app with
`?reminderDone=<id>`, and the app marks it done when the note is loaded. Until a page writes it, the
server push (in connected mode) continues.

## Delivery

The device delivers reminders through three paths, in this order of priority. In connected mode, a
fourth path from the server operates when none of these is awake (see
[Push from the server](#push-from-the-server)):

1. **Service worker notification (primary).** When the user gives notification permission, a
   service worker schedules reminders in IndexedDB, and calls `showNotification` when they are due.
   This path fires also when the tab is closed, if the browser wakes the service worker. Chromium
   with Periodic Background Sync is the most reliable. In Firefox and Safari, the result is not
   guaranteed.
2. **From the open page (fallback while the tab is open).** The page keeps one `setTimeout` for each
   upcoming reminder. It shows the notification through the registration of its service worker. Only
   when there is no worker does it use the `Notification` of the page. The worker path is the path
   that works on phones: Chrome on Android refuses `new Notification()`, and an installed iOS app has
   no `Notification`. When the tab gets focus again, `visibilitychange` finds missed fires (in a
   window of one hour).
3. **In-app banner (fallback when permission is denied).** The app shows a banner with a link to the
   note. You can dismiss the banner. The OS shows no notification.

When you tap a notification, it focuses an open window and opens the note there. If no window is
open, it starts the app at its own scope (not at the root of the origin, so that an instance under a
subpath works), with `?note=<id>`. The app opens that note one time, and removes the parameter from
the URL.

These two things prevent a duplicate fire across the two notification paths:

- The note id is the notification `tag`. The OS combines notifications with the same tag.
- The reminder stores a 60-second `lastFiredAt` window.

## Push from the server

A service worker fires a reminder only while the browser lets it run. On a phone with the app closed,
this usually does not occur. In connected mode, the server does this work. If a reminder becomes due
and no device fired it, the server sends it as a Web Push message. The push service of the browser
delivers it to the installed app, also when the app is not open (iOS 16.4 or later for an app added
to the Home Screen, Android, and desktop browsers).

- **Who gets it.** Each browser of the account that permits notifications and has a subscription. A
  browser subscribes automatically. When notifications are permitted (the app asks, as before, when
  you save the first reminder), and at each start after that, it gets the push key of the server,
  subscribes at its own push service, and gives the subscription to the server. There is no setting
  to turn on.
- **When.** The server examines the reminders each 30 seconds. It acts on a reminder that is due for
  45 seconds and that no device fired. An open app fires its reminder on time, and moves it on almost
  immediately. Thus, the server only acts on a reminder that no client handled. A reminder does not
  arrive two times. A reminder for a closed app arrives up to approximately one minute late. The
  server ignores a reminder that is more than one hour overdue, as the device does.
- **What it does to the reminder.** It does the same as a client that fires it. A repeating reminder
  moves to its next occurrence, by the same rules (the calculation is shared code, `reminderTime.ts`
  in `@manifesto/shared`). A reminder that does not repeat gets the mark fired. The write goes to
  open clients as all changes do. The message tells the service worker the new time of the reminder.
  Thus, its own list does not fire the same occurrence again.
- **The time zone.** The time of a reminder is a wall-clock time. The server reads it in the zone
  where the reminder was made (`NoteReminder.timezone`), not in its own zone.
- **What is sent, and to whom.**
  - The server cannot read a note ([Encryption](encryption.md#reminders)). Thus, it sends the title
    of the note and the first 140 characters of its text as it keeps them: sealed, with the key of
    the note as its reader keeps it.
  - The service worker opens them with the account key, which the device keeps while it is signed in.
    It shows the title and that text. For an untitled note, the title is "Untitled reminder", in the
    language that the account used last in the app.
  - A device that is signed out shows "Untitled reminder", and no data of the note.
  - The full message is also encrypted to the subscription keys of the browser (RFC 8291). Thus, the
    push service that carries it (of Google, Apple or Mozilla) cannot read it.
  - The request is signed with the key of the server (VAPID, RFC 8292). The server makes the key on
    the first use, and keeps it in the database. You do not have to configure anything.
  - We wrote both with `node:crypto` in `push/webPush.ts`. We did not use a library. A test compares
    the encryption with the example in the RFC.
- **How it ends.** A subscription belongs to the session of the browser, and ends with that session:
  a sign-out there, a password change, an admin who ends the sessions of the account, or the expiry
  of the session. It also ends when the push service reports that it is gone, or after ten failed
  sends in sequence. An account keeps the ten most recent subscriptions.
- **Tapping** the notification opens the note, as for all other reminders.

A host turns this off with `WEB_PUSH=off` (see [Server Deployment](../server/deployment.md)). Then
reminders arrive as in open mode. Open mode has no server to send messages, and its delivery is not
guaranteed.

## Recurrence

When a recurring reminder fires, the app moves the stored `time` to the next occurrence:

- `daily`: +1 day
- `weekly`: +7 days
- `monthly`: the same day in the next month, or the last day of that month if the month is shorter
- `yearly`: the same date in the next year. Outside a leap year, 29 February becomes the 28th.

A shorter month moves one occurrence, not the reminder. Each step starts from the day that the
reminder was set for. Thus, the 31st goes to 28 February, and back to 31 March. 29 February comes
back in the next leap year. While a clamped `time` hides that day, the reminder keeps it as `day`.
The app removes `day` again when `time` shows that day. If you change only the hour in the picker, the
reminder keeps `day`. A new date or a new recurrence starts again.

The calculation uses local components. Thus, a reminder at 08:00 local time stays at 08:00 across DST
changes.

## Permission Flow

- The app asks for permission only when the user saves their first reminder.
- If the user gives permission: the app registers the service worker (if possible), and requests
  Periodic Background Sync with a minimum interval of 15 minutes.
- If the user refuses: the app still saves the reminder. It fires through the in-app banner when the
  tab is open. A toast tells this one time.

## Data Model

See [Data Model: NoteReminder](../data-model.md#notereminder).

## Calendar Feed

In connected mode, a calendar app that subscribes to a feed can show the reminders of a user (the
calendar of a phone, Thunderbird, Google Calendar by URL). In Settings → API tokens, a **Calendar
feed** token gives an address to subscribe to. It also gives a `webcal:` link that opens the calendar
app of the device with that address.

- Each note with a reminder is an event at the time of the reminder, in its time zone. The event
  repeats daily, weekly, monthly or yearly, as the reminder does. It has an alarm when it is due.
- A monthly or yearly reminder after the 28th repeats on "the last of the 28th to its day"
  (`BYMONTHDAY` with `BYSETPOS=-1`). `FREQ=MONTHLY` alone skips the months that do not have that
  date, but the app fires on the last day of those months.
- A note in the trash is not in the feed.
- The name of the event is the title of the note, or its first line if it has no title. The event
  contains the text of the note.
- The feed is read-only. If you move an event in the calendar, the reminder does not move.
- The address is the secret. The app shows it one time, when you make the token. All persons who have
  it can read the reminders. To stop the feed, revoke the token in Settings. The address opens
  nothing else, and it is not a sign-in token.
- Notes are [encrypted](encryption.md#tokens-that-carry-a-key). Thus, the address contains a key:
  the key that opens the notes that have a reminder, and no other notes. A reminder that a script set
  shows as "Reminder", without the name or the text of the note, until the next time that the app is
  open on that account.
- Calendar apps get the feed on their own schedule, frequently each few hours. Thus, a changed
  reminder can take that long to show there. The notifications of the app still arrive on time.
- The name of the calendar is the name of the token. Thus, two devices can each have their own
  calendar.

## Limitations

- In open mode, or on a server with `WEB_PUSH=off`, reminders while the tab is closed need the
  browser to wake the service worker. This is not guaranteed. If the browser is fully closed,
  reminders wait until the app opens again, and fire on the visibility change.
- A pushed reminder arrives up to approximately one minute after it is due. This delay makes sure
  that it never arrives two times.
- Reminders are local to the device. In open mode, they do not sync between devices.
