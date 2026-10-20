import { signal } from "@preact/signals";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The banner reports `connectionOutage`, never the raw status. The status
 * leaves "open" on each resume. When the banner reported it, "Disconnected"
 * showed for a moment to a person whose reconnect was already in progress.
 * `connectionOutage` owns the wait, and its own tests check it. These tests
 * check that the banner obeys it, and which of the two messages it selects.
 *
 * Both modules are mocked to the signals that the banner reads, and
 * `isServerMode` is on, because a test build has no configured server.
 */
const connectionStatus = signal<"idle" | "connecting" | "open" | "closed">(
  "open",
);
const connectionOutage = signal(false);

vi.mock("#/realtime/appSocket.ts", () => ({ connectionStatus }));
vi.mock("#/realtime/connectionOutage.ts", () => ({ connectionOutage }));
vi.mock("#/state/account/auth.ts", () => ({ isServerMode: true }));

const { ConnectionStatus } = await import("./ConnectionStatus.tsx");
const { t } = await import("#/i18n/index.ts");

let host: HTMLDivElement;

/** Preact renders again on a microtask. Thus, read the DOM only after one. */
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
