import {
  type AccountPublicKeys,
  NoteColor,
  NoteFont,
  type NoteRekeyRequest,
  type SealedNote,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testKeys } from "#/test/sealedServer.ts";
import { createAccountKeys } from "#/utils/keyMaterial.ts";
import { storageConnection } from "./index.ts";
import { sealer, storageKeys } from "./sealing.ts";
import {
  changedKeys,
  forgetPublicKeys,
  keyStatusOf,
  publicKeysOf as keysGiven,
  replaceNoteKey,
  supplyKey,
  trustChangedKeys,
  trustedKeysOf,
} from "./shareKeys.ts";

/**
 * Whose key it is. The server hands out public keys and keeps the list of
 * the ones an account has seen, sealed; here it is a few maps that a test
 * can tamper with, as a server could.
 */

const publicKeysOf = new Map<string, AccountPublicKeys>();
let seen: Record<string, string>;
let seenReadable: boolean;
let seenWritable: boolean;
/** A note the server holds, what it answers for its public links, and the
 * replacement of its key the server was last sent. */
let held: SealedNote | null;
let linksStatus: number;
let rekeyed: NoteRekeyRequest | null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function server(url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url, "http://server.test").pathname;
  const keys = /^\/api\/v1\/users\/([^/]+)\/keys$/.exec(path);
  if (keys) {
    const userId = decodeURIComponent(keys[1] ?? "");
    const publicKeys = publicKeysOf.get(userId);
    return publicKeys
      ? json({ userId, version: 1, publicKeys })
      : json({ error: "none" }, 404);
  }
  if (path === "/api/v1/auth/keys/seen") {
    return seenReadable ? json({ seen }) : json({ error: "down" }, 500);
  }
  const put = /^\/api\/v1\/auth\/keys\/seen\/([^/]+)$/.exec(path);
  if (put && init?.method === "PUT") {
    if (!seenWritable) return json({ error: "down" }, 500);
    const { sealed } = JSON.parse(String(init.body)) as { sealed: string };
    seen[decodeURIComponent(put[1] ?? "")] = sealed;
    return new Response(null, { status: 204 });
  }
  if (held && path === `/api/v1/notes/${held.id}`) return json({ note: held });
  if (held && path === `/api/v1/notes/${held.id}/links`) {
    return linksStatus === 200
      ? json({ links: [] })
      : json({ error: "no" }, linksStatus);
  }
  if (
    held &&
    path === `/api/v1/notes/${held.id}/key` &&
    init?.method === "PUT"
  ) {
    rekeyed = JSON.parse(String(init.body)) as NoteRekeyRequest;
    return json({ note: held });
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
  held = null;
  linksStatus = 200;
  rekeyed = null;
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

  it("takes a first key only once the server has kept it", async () => {
    await unlock(await testKeys("u-me"));
    publicKeysOf.set("u-alice", await someKeys());
    seenWritable = false;
    expect(await trustedKeysOf("u-alice")).toBeNull();
    // Worth trying again: the request did not get through.
    expect(await supplyKey("n1", "u-alice")).toBe("failed");
    expect(seen).toEqual({});

    seenWritable = true;
    expect(await trustedKeysOf("u-alice")).not.toBeNull();
    expect(Object.keys(seen)).toEqual(["u-alice"]);
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

describe("handing someone a note's key", () => {
  it("is worth trying again only when a request did not get through", async () => {
    await unlock(await testKeys("u-me"));
    publicKeysOf.set("u-alice", await someKeys());
    // Their keys were read; what this account remembers of them was not.
    seenReadable = false;
    expect(await supplyKey("n1", "u-alice")).toBe("failed");
    // Nobody to wrap to, however often it is asked.
    expect(await supplyKey("n1", "u-nobody")).toBe("unable");
    seenReadable = true;
    expect(await trustedKeysOf("u-alice")).not.toBeNull();
    // A changed key waits for the person, not for another try.
    for (const id of publicKeysOf.keys()) forgetPublicKeys(id);
    publicKeysOf.set("u-alice", await someKeys());
    expect(await supplyKey("n1", "u-alice")).toBe("unable");
  });
});

describe("asking for someone's keys", () => {
  it("asks again for someone who had none, once they have set them up", async () => {
    await unlock(await testKeys("u-me"));
    expect(await trustedKeysOf("u-bob")).toBeNull();
    expect(await supplyKey("n1", "u-bob")).toBe("unable");
    publicKeysOf.set("u-bob", await someKeys());
    expect(await trustedKeysOf("u-bob")).not.toBeNull();
  });

  it("keeps nothing from one unlocked account to the next", async () => {
    await unlock(await testKeys("u-me"));
    publicKeysOf.set("u-alice", await someKeys());
    await keysGiven("u-alice");
    const now = await someKeys();
    publicKeysOf.set("u-alice", now);
    // Another account in the same tab, with nothing forgotten by hand.
    storageKeys.value = { ...(await testKeys("u-other")) };
    expect((await keysGiven("u-alice"))?.publicKeys).toEqual(now);
  });
});

describe("replacing a note's key", () => {
  async function dueNote(): Promise<void> {
    await unlock(await testKeys("u-me"));
    const sealed = await sealer.peek()?.sealNew("n1", {
      title: "Trip plan",
      content: "Fly on the third.",
      color: NoteColor.Yellow,
      font: NoteFont.Serif,
      pinned: false,
      archived: false,
      trashed: false,
      trashedAt: null,
      position: 0,
      tags: [],
      images: [],
      linkPreviews: [],
      reminder: null,
    });
    if (!sealed) throw new Error("locked");
    const { imageRefs: _i, previewRefs: _p, ...note } = sealed;
    held = { ...note, createdAt: "c", updatedAt: "u", rekeyDue: true };
  }

  it("replaces it on a server with public links switched off", async () => {
    await dueNote();
    linksStatus = 404;
    expect(await replaceNoteKey("n1")).toBe(true);
    expect(rekeyed?.keyVersion).toBe(2);
    expect(rekeyed?.links).toBeUndefined();
  });

  it("leaves it due while the note's links cannot be read", async () => {
    await dueNote();
    linksStatus = 500;
    expect(await replaceNoteKey("n1")).toBe(false);
    expect(rekeyed).toBeNull();
  });
});
