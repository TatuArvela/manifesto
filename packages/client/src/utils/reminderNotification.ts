// What an urgent reminder adds to its notification. The page and the service
// worker both show reminders, and must show an urgent one in the same way.

/** The action of the "Done" button on the notification of an urgent reminder. */
export const DONE_ACTION = "done";

/**
 * The notification stays until the user acts on it, sounds again when it
 * repeats, and has a "Done" button. Empty for a reminder that is not urgent.
 */
export function urgentOptions(
  urgent: boolean,
  doneLabel: string | undefined,
): NotificationOptions {
  if (!urgent) return {};
  // `renotify` and `actions` are not in the DOM types of TypeScript yet.
  return {
    requireInteraction: true,
    // The same tag shows again silently. An urgent repeat must be heard.
    renotify: true,
    ...(doneLabel && { actions: [{ action: DONE_ACTION, title: doneLabel }] }),
  } as NotificationOptions;
}
