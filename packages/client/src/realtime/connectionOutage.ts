import { signal } from "@preact/signals";
import type { ConnectionStatus } from "./appSocket.js";

/**
 * How long the socket may be away before we call it an outage.
 *
 * An app resumed from the background always finds its socket gone: the browser
 * closed it while the page was frozen, and `appSocket` dials again as soon as
 * we are visible. Reporting that round trip flashed "Disconnected" on every
 * single resume at someone whose connection was never in doubt, so the wait is
 * long enough to cover an ordinary reconnect, including a phone's radio waking
 * up, and short enough that a real outage is still news.
 */
export const OUTAGE_AFTER_MS = 4000;

/**
 * True once the application socket has been away for {@link OUTAGE_AFTER_MS}
 * without getting back. This, not `connectionStatus`, is what the UI reports:
 * the status flips too often, and for too little, to show as it is.
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
 * Follow a status write. Reaching the server, or wanting nothing from it,
 * clears the outage at once; leaving it starts the clock.
 */
export function trackConnection(status: ConnectionStatus): void {
  if (status === "open" || status === "idle") {
    cancel();
    connectionOutage.value = false;
    return;
  }
  // Armed once per outage rather than once per status write: "connecting" and
  // "closed" alternate as the backoff retries, and rearming on each of them
  // would put the outage off for as long as the outage itself lasted.
  //
  // `peek`, because this runs inside whatever effect wrote the status, and a
  // read there would subscribe that effect to the outage. `appSocket`'s token
  // effect is one: the outage arriving re-ran it, which redialled on a 4s
  // cycle whatever the backoff said and forgot the socket had ever been open,
  // so the reconnect skipped its catch-up fetch.
  if (timer || connectionOutage.peek()) return;
  timer = setTimeout(() => {
    timer = null;
    connectionOutage.value = true;
  }, OUTAGE_AFTER_MS);
}
