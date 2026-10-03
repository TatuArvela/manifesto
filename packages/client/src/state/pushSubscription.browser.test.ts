import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "../storage/index.js";
import {
  ensurePushSubscription,
  removePushSubscription,
} from "./pushSubscription.js";
import { DEFAULT_SERVER_FEATURES, serverFeatures } from "./serverFeatures.js";

const SERVER = "http://server.test";
/** 65 bytes, as a push key is; the content does not matter here. */
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
const KEY = btoa(String.fromCharCode(...KEY_BYTES))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON(): { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

function subscriptionWith(key: Uint8Array, endpoint: string): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: key.slice().buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: "p256", auth: "auth" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

let held: FakeSubscription | null;
const subscribe = vi.fn(
  async (options: { applicationServerKey: Uint8Array }) => {
    held = subscriptionWith(
      options.applicationServerKey,
      "https://push.example/send/new",
    );
    return held;
  },
);
const requests: { method: string; path: string; body: unknown }[] = [];
let permission: NotificationPermission;

beforeEach(() => {
  held = null;
  subscribe.mockClear();
  requests.length = 0;
  permission = "granted";
  storageConnection.value = { serverUrl: SERVER, token: "tok" };
  serverFeatures.value = { ...DEFAULT_SERVER_FEATURES, pushReminders: true };
  vi.stubGlobal("Notification", {
    get permission() {
      return permission;
    },
  });
  const registration = {
    pushManager: { getSubscription: async () => held, subscribe },
  };
  Object.defineProperty(navigator.serviceWorker, "ready", {
    configurable: true,
    get: () => Promise.resolve(registration),
  });
  vi.spyOn(navigator.serviceWorker, "getRegistration").mockResolvedValue(
    registration as unknown as ServiceWorkerRegistration,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(`${SERVER}/api`, "");
      requests.push({
        method: init?.method ?? "GET",
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return path === "/push/key"
        ? new Response(JSON.stringify({ publicKey: KEY }), { status: 200 })
        : new Response(null, { status: 204 });
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Back to the browser's own getter.
  Reflect.deleteProperty(navigator.serviceWorker, "ready");
  storageConnection.value = { serverUrl: null, token: null };
  serverFeatures.value = DEFAULT_SERVER_FEATURES;
});

describe("ensurePushSubscription", () => {
  it("subscribes with the server's key and hands the subscription over", async () => {
    expect(await ensurePushSubscription()).toBe(true);

    expect(subscribe).toHaveBeenCalledTimes(1);
    const options = subscribe.mock.calls[0]?.[0];
    expect(options).toMatchObject({ userVisibleOnly: true });
    expect([...(options?.applicationServerKey ?? [])]).toEqual([...KEY_BYTES]);
    expect(requests).toEqual([
      { method: "GET", path: "/push/key", body: undefined },
      {
        method: "POST",
        path: "/push/subscriptions",
        body: {
          endpoint: "https://push.example/send/new",
          keys: { p256dh: "p256", auth: "auth" },
        },
      },
    ]);
  });

  it("sends a subscription it already has again, without making another", async () => {
    held = subscriptionWith(KEY_BYTES, "https://push.example/send/held");
    expect(await ensurePushSubscription()).toBe(true);
    expect(subscribe).not.toHaveBeenCalled();
    expect(requests.at(-1)?.body).toMatchObject({
      endpoint: "https://push.example/send/held",
    });
  });

  it("replaces a subscription made with another server's key", async () => {
    const other = subscriptionWith(
      KEY_BYTES.map((b) => b ^ 1),
      "https://push.example/send/old",
    );
    held = other;
    expect(await ensurePushSubscription()).toBe(true);
    expect(other.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(requests.at(-1)?.body).toMatchObject({
      endpoint: "https://push.example/send/new",
    });
  });

  it("does nothing until notifications are allowed, and never asks", async () => {
    permission = "default";
    expect(await ensurePushSubscription()).toBe(false);
    expect(requests).toEqual([]);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("does nothing on a server without push", async () => {
    serverFeatures.value = DEFAULT_SERVER_FEATURES;
    expect(await ensurePushSubscription()).toBe(false);
    expect(requests).toEqual([]);
  });

  it("says it did not work, and does not throw, when the browser refuses", async () => {
    subscribe.mockRejectedValueOnce(new Error("no push service"));
    expect(await ensurePushSubscription()).toBe(false);
    expect(requests.map((r) => r.path)).toEqual(["/push/key"]);
  });
});

describe("removePushSubscription", () => {
  it("tells the server and gives the subscription up", async () => {
    const mine = subscriptionWith(KEY_BYTES, "https://push.example/send/held");
    held = mine;
    await removePushSubscription();
    expect(requests).toEqual([
      {
        method: "DELETE",
        path: "/push/subscriptions",
        body: { endpoint: "https://push.example/send/held" },
      },
    ]);
    expect(mine.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("has nothing to do in a browser that never subscribed", async () => {
    await removePushSubscription();
    expect(requests).toEqual([]);
  });

  it("does not wait for a service worker that was never registered", async () => {
    // `ready` never settles there; signing out must not hang on it.
    Object.defineProperty(navigator.serviceWorker, "ready", {
      configurable: true,
      get: () => new Promise(() => {}),
    });
    vi.spyOn(navigator.serviceWorker, "getRegistration").mockResolvedValue(
      undefined,
    );
    await removePushSubscription();
    expect(requests).toEqual([]);
  });
});
