import type { AccountKeysSetupRequest } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceKeys } from "#/storage/deviceKeys.ts";

vi.mock("#/config.ts", async (original) => ({
  ...(await original<typeof import("#/config.ts")>()),
  resolveServerUrl: () => "https://notes.example",
  resolveServerOrigin: () => "https://notes.example",
}));

// The device's copy, which every tab of a browser shares. Node has no
// IndexedDB, so it is kept here, and read back as another object each time,
// as a stored `CryptoKey` is.
let device: DeviceKeys | null = null;
/** False for a browser that refuses IndexedDB: nothing is kept or read. */
let deviceKeeps = true;
vi.mock("#/storage/deviceKeys.ts", () => ({
  saveDeviceKeys: async (keys: DeviceKeys) => {
    if (!deviceKeeps) return false;
    device = keys;
    return true;
  },
  loadDeviceKeys: async () => (deviceKeeps && device ? { ...device } : null),
  clearDeviceKeys: async () => {
    device = null;
  },
}));

const { authToken, currentUser } = await import("./auth.ts");
const keys = await import("./accountKeys.ts");
const { storageKeys } = await import("#/storage/sealing.ts");

const USER = {
  id: "01HZX3KQ0000000000000000AA",
  username: "alice",
  displayName: "Alice",
  avatarColor: "#000",
  email: null,
  isAdmin: false,
  hasPassword: true,
};

let stored: (AccountKeysSetupRequest & { version: number }) | null;

async function server(input: string, init?: RequestInit): Promise<Response> {
  const path = input.replace("https://notes.example/api/v1", "");
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  switch (`${init?.method ?? "GET"} ${path}`) {
    case "GET /auth/keys":
      return json({
        keys: stored && {
          version: stored.version,
          wrappedBySecret: stored.wrappedBySecret,
          publicKeys: stored.publicKeys,
          wrappedPrivateKeys: stored.wrappedPrivateKeys,
        },
        sessionEndsAt: "2099-01-01T00:00:00.000Z",
      });
    case "PUT /auth/keys":
      stored = { ...(body as AccountKeysSetupRequest), version: 1 };
      return new Response(null, { status: 204 });
    case "POST /auth/keys/confirm":
      return new Response(null, { status: 204 });
    case "POST /auth/keys/secret":
      if (stored) stored.wrappedBySecret = body.wrappedBySecret;
      return new Response(null, { status: 204 });
    default:
      return new Response("{}", { status: 404 });
  }
}

const state = (kind: string) =>
  vi.waitFor(() => expect(keys.keyState.value).toBe(kind));

/** What another tab of this browser says, after writing the device's copy. */
function anotherTabSays(said: string): void {
  const tab = new BroadcastChannel("manifesto:keys");
  tab.postMessage(said);
  tab.close();
}

/** Long enough for a message to arrive and be acted on. */
const heard = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("account keys across tabs", () => {
  beforeEach(async () => {
    stored = null;
    device = null;
    deviceKeeps = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => server(input, init)),
    );
    authToken.value = "session-1";
    currentUser.value = USER;
    await state("setup");
    await keys.prepareSetup();
    expect(await keys.completeSetup()).toBe("ok");
  });

  afterEach(async () => {
    authToken.value = null;
    currentUser.value = null;
    await state("none");
    vi.unstubAllGlobals();
  });

  it("keeps what it holds when another tab unlocks the same account", async () => {
    const before = storageKeys.value;
    const seen: string[] = [];
    const stop = keys.keyState.subscribe((value) => seen.push(value));
    anotherTabSays("held");
    await heard();
    stop();
    // Never locked, never checking: the app stayed up, and storage seals
    // with the key it had, so the notes and images it opened stay open.
    expect(seen).toEqual(["unlocked"]);
    expect(storageKeys.value).toBe(before);
  });

  it("takes a new secret key for the same account key as it is", async () => {
    const before = storageKeys.value;
    if (!device) throw new Error("nothing was kept on the device");
    device = { ...device, secretKey: "SK-from-the-other-tab" };
    anotherTabSays("held");
    await heard();
    expect(keys.keyState.value).toBe("unlocked");
    expect(storageKeys.value).toBe(before);
    // What Settings shows to bring a device in is the key that works now.
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as typeof fetch;
    expect(await keys.revealSecretKey("")).toEqual({
      kind: "ok",
      secretKey: "SK-from-the-other-tab",
    });
  });

  it("keeps what it holds when the device's copy cannot be read", async () => {
    const before = storageKeys.value;
    deviceKeeps = false;
    const seen: string[] = [];
    const stop = keys.keyState.subscribe((value) => seen.push(value));
    anotherTabSays("held");
    await heard();
    stop();
    expect(seen).toEqual(["unlocked"]);
    expect(storageKeys.value).toBe(before);
  });

  it("tells the other tabs nothing when the device kept no copy", async () => {
    const said: unknown[] = [];
    const tab = new BroadcastChannel("manifesto:keys");
    tab.onmessage = (event) => said.push(event.data);
    const renew = async () => {
      expect((await keys.prepareSecretKey("")).kind).toBe("ok");
      return (await keys.completeRenewal("")).kind;
    };
    deviceKeeps = false;
    expect(await renew()).toBe("ok");
    await heard();
    expect(said).toEqual([]);
    deviceKeeps = true;
    expect(await renew()).toBe("ok");
    await vi.waitFor(() => expect(said).toEqual(["held"]));
    tab.close();
  });

  it("lets go of keys another tab removed", async () => {
    stored = null;
    device = null;
    anotherTabSays("gone");
    await state("setup");
    expect(storageKeys.value).toBeNull();
  });

  it("lets go of keys that are not the device's any more", async () => {
    if (!device) throw new Error("nothing was kept on the device");
    device = { ...device, version: 2 };
    anotherTabSays("held");
    await vi.waitFor(() => expect(storageKeys.value?.version).toBe(2));
    expect(keys.keyState.value).toBe("unlocked");
  });
});
