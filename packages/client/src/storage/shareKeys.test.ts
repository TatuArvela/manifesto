import type { AccountPublicKeys } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testKeys } from "../test/sealedServer.js";
import { createAccountKeys } from "../utils/keyMaterial.js";
import { storageConnection } from "./index.js";
import { storageKeys } from "./sealing.js";
import {
  changedKeys,
  forgetPublicKeys,
  keyStatusOf,
  trustChangedKeys,
  trustedKeysOf,
} from "./shareKeys.js";

/**
 * Whose key it is. The server hands out public keys and keeps the list of
 * the ones an account has seen, sealed; here it is a few maps that a test
 * can tamper with, as a server could.
 */

const publicKeysOf = new Map<string, AccountPublicKeys>();
let seen: Record<string, string>;
let seenReadable: boolean;
let seenWritable: boolean;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function server(url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url, "http://server.test").pathname;
  const keys = /^\/api\/users\/([^/]+)\/keys$/.exec(path);
  if (keys) {
    const userId = decodeURIComponent(keys[1] ?? "");
    const publicKeys = publicKeysOf.get(userId);
    return publicKeys
      ? json({ userId, version: 1, publicKeys })
      : json({ error: "none" }, 404);
  }
  if (path === "/api/auth/keys/seen") {
    return seenReadable ? json({ seen }) : json({ error: "down" }, 500);
  }
  const put = /^\/api\/auth\/keys\/seen\/([^/]+)$/.exec(path);
  if (put && init?.method === "PUT") {
    if (!seenWritable) return json({ error: "down" }, 500);
    const { sealed } = JSON.parse(String(init.body)) as { sealed: string };
    seen[decodeURIComponent(put[1] ?? "")] = sealed;
    return new Response(null, { status: 204 });
  }
  return json({ error: "unexpected" }, 500);
}

const someKeys = async () =>
  (await createAccountKeys("someone")).request.publicKeys;

/** A device of the account: unlocked, with nothing remembered in memory. */
async function unlock(keys: Awaited<ReturnType<typeof testKeys>>) {
  storageKeys.value = null;
  storageKeys.value = { ...keys };
  for (const id of publicKeysOf.keys()) forgetPublicKeys(id);
}

beforeEach(() => {
  publicKeysOf.clear();
  seen = {};
  seenReadable = true;
  seenWritable = true;
  changedKeys.value = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => server(String(url), init)),
  );
  storageConnection.value = { serverUrl: "", token: "tok" };
});

afterEach(() => {
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
  storageKeys.value = null;
});

describe("remembering other people's keys", () => {
  it("takes the first key it sees for someone, and keeps it sealed on the server", async () => {
    const mine = await testKeys("u-me");
    await unlock(mine);
    const alice = await someKeys();
    publicKeysOf.set("u-alice", alice);

    expect((await trustedKeysOf("u-alice"))?.publicKeys).toEqual(alice);
    expect(Object.keys(seen)).toEqual(["u-alice"]);
    // Nothing of the key is readable there.
    expect(seen["u-alice"]).toMatch(/^e1\./);
    expect(JSON.stringify(seen)).not.toContain(alice.signing);
    // Someone with no keys yet is nobody to remember.
    expect(await trustedKeysOf("u-nobody")).toBeNull();
    expect(Object.keys(seen)).toEqual(["u-alice"]);
  });

  it("uses a changed key for nothing, on another device too, until the person trusts it", async () => {
    const mine = await testKeys("u-me");
    await unlock(mine);
    const first = await someKeys();
    publicKeysOf.set("u-alice", first);
    await trustedKeysOf("u-alice");
    const fingerprint = (await keyStatusOf("u-alice"))?.fingerprint;

    // The server gives another key for her, to a device that starts fresh.
    const swapped = await someKeys();
    publicKeysOf.set("u-alice", swapped);
    await unlock(mine);
    expect(await trustedKeysOf("u-alice")).toBeNull();
    expect(changedKeys.value.get("u-alice")?.publicKeys).toEqual(swapped);
    const status = await keyStatusOf("u-alice");
    expect(status?.changed).toBe(true);
    expect(status?.fingerprint).not.toBe(fingerprint);
    expect(status?.fingerprint).toMatch(/^([0-9A-F]{4} ){5}[0-9A-F]{4}$/);

    // She did start again, and said so: the new key is the one remembered.
    expect(await trustChangedKeys("u-alice")).toBe(true);
    expect(changedKeys.value.has("u-alice")).toBe(false);
    expect((await trustedKeysOf("u-alice"))?.publicKeys).toEqual(swapped);
    await unlock(mine);
    expect((await trustedKeysOf("u-alice"))?.publicKeys).toEqual(swapped);
    expect((await keyStatusOf("u-alice"))?.changed).toBe(false);
  });

  it("keeps the key it remembered when trusting a changed one fails", async () => {
    const mine = await testKeys("u-me");
    await unlock(mine);
    publicKeysOf.set("u-alice", await someKeys());
    await trustedKeysOf("u-alice");
    const swapped = await someKeys();
    publicKeysOf.set("u-alice", swapped);
    forgetPublicKeys("u-alice");
    expect(await trustedKeysOf("u-alice")).toBeNull();

    // The server does not take the new key: nothing was agreed to.
    seenWritable = false;
    expect(await trustChangedKeys("u-alice")).toBe(false);
    // The swapped key is not met as a first sighting afterwards.
    expect(await trustedKeysOf("u-alice")).toBeNull();
    expect(changedKeys.value.get("u-alice")?.publicKeys).toEqual(swapped);

    seenWritable = true;
    expect(await trustChangedKeys("u-alice")).toBe(true);
    expect((await trustedKeysOf("u-alice"))?.publicKeys).toEqual(swapped);
  });

  it("trusts nobody while the list cannot be read, and opens no other account's list", async () => {
    const mine = await testKeys("u-me");
    await unlock(mine);
    publicKeysOf.set("u-alice", await someKeys());
    seenReadable = false;
    expect(await trustedKeysOf("u-alice")).toBeNull();
    expect(seen).toEqual({});
    // Once it can be read, it is asked again.
    seenReadable = true;
    expect(await trustedKeysOf("u-alice")).not.toBeNull();

    // The same entry handed to another account, or put under another
    // person's name, opens for neither: each then meets the key as new.
    const entry = seen["u-alice"] ?? "";
    publicKeysOf.set("u-bob", await someKeys());
    seen = { "u-bob": entry };
    await unlock(mine);
    expect(await trustedKeysOf("u-bob")).not.toBeNull();
    expect(changedKeys.value.size).toBe(0);
  });
});
