import { signal } from "@preact/signals";
import type { ConnectionStatus } from "./appSocket.ts";

/**
 * How long the socket can be away before we call it an outage.
 *
 * An app that resumes from the background always finds its socket gone. The
 * browser closed it while the page was frozen, and `appSocket` connects again
 * when we are visible. When the app reported that round trip, "Disconnected"
 * showed on each resume to a person whose connection was never in doubt. Thus,
 * the wait is long enough for a usual reconnect, also for the radio of a phone
 * that wakes, and short enough that a real outage is still news.
 */
export const OUTAGE_AFTER_MS = 4000;

/**
 * True after the application socket was away for {@link OUTAGE_AFTER_MS} and
 * did not come back. The UI reports this, not `connectionStatus`. The status
 * changes too frequently, and for too little, to show it as it is.
 */
export const connectionOutage = signal(false);

let timer: ReturnType<typeof setTimeout> | null = null;

function cancel() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Follow a status write. When the client reaches the server, or wants nothing
 * from it, the outage clears immediately. When it leaves the server, the clock
 * starts.
 */
export function trackConnection(status: ConnectionStatus): void {
  if (status === "open" || status === "idle") {
    cancel();
    connectionOutage.value = false;
    return;
  }
  // Started one time for each outage, not one time for each status write.
  // "connecting" and "closed" alternate while the backoff tries again, and a
  // new start on each of them would delay the outage for as long as the outage
  // itself lasted.
  //
  // `peek`, because this runs inside the effect that wrote the status, and a
  // read there would subscribe that effect to the outage. The token effect of
  // `appSocket` is one. When the outage arrived, it ran again. It connected
  // again on a 4s cycle, whatever the backoff said, and forgot that the socket
  // was ever open. Thus, the reconnect skipped its catch-up fetch.
  if (timer || connectionOutage.peek()) return;
  timer = setTimeout(() => {
    timer = null;
    connectionOutage.value = true;
  }, OUTAGE_AFTER_MS);
}
