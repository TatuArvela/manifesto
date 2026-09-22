import { signal } from "@preact/signals";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The banner reports `connectionOutage`, never the raw status: the status
 * leaves "open" on every resume, and saying so there flashed "Disconnected" at
 * someone whose reconnect was already under way. The waiting itself is
 * `connectionOutage`'s and is tested there; this is about the banner honouring
 * it, and about which of the two messages it picks.
 *
 * Both modules are mocked down to the signals the banner reads, and
 * `isServerMode` forced on, since a test build has no server configured.
 */
const connectionStatus = signal<"idle" | "connecting" | "open" | "closed">(
  "open",
);
const connectionOutage = signal(false);

vi.mock("../realtime/appSocket.js", () => ({ connectionStatus }));
vi.mock("../realtime/connectionOutage.js", () => ({ connectionOutage }));
vi.mock("../state/auth.js", () => ({ isServerMode: true }));

const { ConnectionStatus } = await import("./ConnectionStatus.js");
const { t } = await import("../i18n/index.js");

let host: HTMLDivElement;

/** Preact rerenders on a microtask, so read the DOM only after one. */
async function banner() {
  await Promise.resolve();
  return host.querySelector("[role='status']");
}

beforeEach(() => {
  connectionStatus.value = "open";
  connectionOutage.value = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  render(<ConnectionStatus />, host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("the connection banner", () => {
  it("stays out of the way until there is an outage", async () => {
    connectionStatus.value = "closed";
    expect(await banner()).toBeNull();
  });

  it("reports an outage the socket is still trying to end", async () => {
    connectionStatus.value = "connecting";
    connectionOutage.value = true;
    expect((await banner())?.textContent).toContain(
      t("connection.reconnecting"),
    );
  });

  it("reports one it is waiting out the backoff on", async () => {
    connectionStatus.value = "closed";
    connectionOutage.value = true;
    expect((await banner())?.textContent).toContain(
      t("connection.disconnected"),
    );
  });

  it("goes away when the outage ends", async () => {
    connectionOutage.value = true;
    connectionStatus.value = "closed";
    expect(await banner()).not.toBeNull();

    connectionOutage.value = false;
    connectionStatus.value = "open";
    expect(await banner()).toBeNull();
  });
});
