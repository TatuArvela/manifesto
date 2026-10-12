import { randomBytes } from "node:crypto";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_CONFIG } from "../test/setup.js";
import {
  AT_REST,
  AT_REST_COLUMNS,
  createAtRest,
  parseServerKey,
  useAtRest,
} from "./atRest.js";
import { claimed } from "./contracts/claimed.js";
import { createStorage } from "./index.js";
import {
  type KeyFiles,
  loadServerKeys,
  moveToCurrentKey,
} from "./serverKey.js";
import type { StorageDriver } from "./types.js";

const A = randomBytes(32);
const B = randomBytes(32);
const T0 = "2026-04-01T00:00:00.000Z";

describe("values under the server key", () => {
  it("open with the key they were sealed under, and only as what they were sealed as", () => {
    const key = createAtRest({ current: A, previous: null });
    const stored = key.seal("JBSWY3DPEHPK3PXP", AT_REST.totpSecret);
    expect(stored).toMatch(/^s1\.[0-9a-f]{8}\./);
    expect(stored).not.toContain("JBSWY3DP");
    expect(key.open(stored, AT_REST.totpSecret)).toBe("JBSWY3DPEHPK3PXP");
    // The same value twice is two ciphertexts.
    expect(key.seal("JBSWY3DPEHPK3PXP", AT_REST.totpSecret)).not.toBe(stored);
    // Moved to another column, or tampered with, it opens as nothing.
    expect(key.open(stored, AT_REST.webhookSecret)).toBeNull();
    expect(key.open(`${stored.slice(0, -2)}AA`, AT_REST.totpSecret)).toBeNull();
    expect(
      createAtRest({ current: B, previous: null }).open(
        stored,
        AT_REST.totpSecret,
      ),
    ).toBeNull();
  });

  it("reads what was stored before there was a key, and moves it under one", () => {
    const key = createAtRest({ current: A, previous: null });
    expect(key.open("whsec_plain", AT_REST.webhookSecret)).toBe("whsec_plain");
    const moved = key.moved("whsec_plain", AT_REST.webhookSecret);
    expect(moved).toMatch(/^s1\./);
    expect(key.open(moved ?? "", AT_REST.webhookSecret)).toBe("whsec_plain");
    // Already under the current key: nothing to do.
    expect(key.moved(moved ?? "", AT_REST.webhookSecret)).toBeNull();
  });

  it("keeps the key before readable until its values are moved", () => {
    const old = createAtRest({ current: A, previous: null }).seal(
      "v",
      AT_REST.serverSecret,
    );
    const both = createAtRest({ current: B, previous: A });
    expect(both.open(old, AT_REST.serverSecret)).toBe("v");
    expect(both.underPrevious(old)).toBe(true);
    const moved = both.moved(old, AT_REST.serverSecret) ?? "";
    expect(both.underPrevious(moved)).toBe(false);
    expect(
      createAtRest({ current: B, previous: null }).open(
        moved,
        AT_REST.serverSecret,
      ),
    ).toBe("v");
  });

  it("takes a key as 32 bytes in base64 or hex, and nothing else", () => {
    expect(parseServerKey(A.toString("base64"))?.equals(A)).toBe(true);
    expect(parseServerKey(`${A.toString("base64url")}\n`)?.equals(A)).toBe(
      true,
    );
    expect(parseServerKey(A.toString("hex"))?.equals(A)).toBe(true);
    expect(parseServerKey("correct horse battery staple")).toBeNull();
    expect(parseServerKey(randomBytes(16).toString("base64"))).toBeNull();
  });
});

describe("finding the server key", () => {
  const cfg = {
    ...TEST_CONFIG,
    dataDir: "/srv/manifesto",
    dbPath: "/srv/manifesto/manifesto.db",
    dataEncryptionKey: null,
  };
  function disk(initial: Record<string, string> = {}) {
    const held = new Map(Object.entries(initial));
    const files: KeyFiles = {
      exists: (path) => held.has(path),
      read: (path) => held.get(path) ?? "",
      create(path, content) {
        if (held.has(path)) throw new Error("EEXIST");
        held.set(path, content);
      },
    };
    return { held, files };
  }

  it("uses the operator's key, and refuses one that is not a key", () => {
    const { held, files } = disk();
    const keys = loadServerKeys(
      {
        ...cfg,
        dataEncryptionKey: A.toString("base64"),
        dataEncryptionKeyPrevious: B.toString("hex"),
      },
      files,
    );
    expect(keys.current.equals(A)).toBe(true);
    expect(keys.previous?.equals(B)).toBe(true);
    // Supplied, so nothing is written anywhere.
    expect(held.size).toBe(0);
    expect(() =>
      loadServerKeys({ ...cfg, dataEncryptionKey: "hunter2" }, files),
    ).toThrow(/DATA_ENCRYPTION_KEY must be 32 random bytes/);
  });

  it("makes a key file on first start and reads the same key after", () => {
    const { held, files } = disk();
    const first = loadServerKeys(cfg, files);
    expect([...held.keys()]).toEqual(["/srv/manifesto/server.key"]);
    expect(loadServerKeys(cfg, files).current.equals(first.current)).toBe(true);
    // Kept where it was told to, when it was told.
    const elsewhere = loadServerKeys(
      { ...cfg, dataKeyFile: "/etc/manifesto/key" },
      files,
    );
    expect(held.has("/etc/manifesto/key")).toBe(true);
    expect(elsewhere.current.equals(first.current)).toBe(false);
    expect(() =>
      loadServerKeys(cfg, disk({ "/srv/manifesto/server.key": "x" }).files),
    ).toThrow(/key file/);
  });
});

describe("moving stored values to the current key", () => {
  let storage: StorageDriver;

  afterEach(async () => {
    await storage.close();
    useAtRest(null);
  });

  /** Every value under the server key, as its column holds it. */
  async function raw(): Promise<string[]> {
    const seen: string[] = [];
    for (const { table, keys, column } of AT_REST_COLUMNS) {
      await storage.maintenance.rewriteColumn(table, keys, column, (stored) => {
        seen.push(stored);
        return null;
      });
    }
    return seen;
  }

  const reminder = {
    time: "2026-05-01T09:30:00",
    recurrence: "none" as const,
    timezone: "Europe/Helsinki",
  };

  async function fill(): Promise<void> {
    await storage.users.create({
      id: "u1",
      username: "u1",
      passwordHash: "h",
      displayName: "",
      avatarColor: "#123456",
      provider: "local",
      externalId: null,
      createdAt: T0,
    });
    await storage.sessions.create({
      token: "session-u1",
      userId: "u1",
      createdAt: T0,
      expiresAt: "2999-01-01T00:00:00.000Z",
      lastSeenAt: T0,
    });
    await storage.notes.insert({
      id: "n1",
      userId: "u1",
      data: claimed({
        title: "",
        content: "",
        color: NoteColor.Default,
        font: NoteFont.Default,
        pinned: false,
        archived: false,
        trashed: false,
        trashedAt: null,
        position: 0,
        tags: [],
        images: [],
        linkPreviews: [],
        reminder,
      }),
      createdAt: T0,
      updatedAt: T0,
    });
    await storage.webhooks.create({
      id: "w1",
      userId: "u1",
      url: "https://hooks.example/in",
      secret: "whsec_first",
      events: ["note.created"],
      active: true,
      createdAt: T0,
      lastDeliveryAt: null,
      lastStatus: null,
      lastError: null,
      failureCount: 0,
    });
    await storage.twoFactor.begin("u1", "JBSWY3DPEHPK3PXP", T0);
    await storage.serverSecrets.setIfAbsent("vapid", "private-key", T0);
    await storage.pushSubscriptions.save({
      id: "s1",
      userId: "u1",
      sessionToken: "session-u1",
      endpoint: "https://push.example/send/one",
      p256dh: "browser-key",
      auth: "browser-auth",
      createdAt: T0,
      failureCount: 0,
    });
  }

  async function readable(): Promise<void> {
    expect((await storage.notes.getById("n1", "u1"))?.reminder).toEqual(
      reminder,
    );
    expect((await storage.webhooks.get("w1", "u1"))?.secret).toBe(
      "whsec_first",
    );
    expect((await storage.twoFactor.get("u1"))?.secret).toBe(
      "JBSWY3DPEHPK3PXP",
    );
    expect(await storage.serverSecrets.get("vapid")).toBe("private-key");
    expect(await storage.pushSubscriptions.listByUser("u1")).toEqual([
      expect.objectContaining({ p256dh: "browser-key", auth: "browser-auth" }),
    ]);
  }

  it("stores each of them sealed, and gives them back as they were", async () => {
    storage = await createStorage(TEST_CONFIG);
    await fill();
    const stored = await raw();
    expect(stored).toHaveLength(6);
    for (const value of stored) expect(value).toMatch(/^s1\./);
    const all = stored.join(" ");
    for (const plain of ["whsec_first", "JBSWY3DP", "private-key", "09:30"]) {
      expect(all).not.toContain(plain);
    }
    await readable();
    // Under the current key already: a start-up has nothing to move.
    expect(await moveToCurrentKey(storage, false)).toBe(0);
  });

  it("moves what a server from before the key stored, and what is under the key before", async () => {
    storage = await createStorage(TEST_CONFIG);
    // As a server without a key wrote them.
    useAtRest(null);
    await fill();
    expect((await raw()).some((value) => value.startsWith("s1."))).toBe(false);

    // The first start with a key: read as they are, then sealed.
    useAtRest(createAtRest({ current: A, previous: null }));
    await readable();
    expect(await moveToCurrentKey(storage, false)).toBe(6);
    expect((await raw()).every((value) => value.startsWith("s1."))).toBe(true);
    await readable();

    // The key is replaced: the one before stays readable, and is moved off.
    const both = createAtRest({ current: B, previous: A });
    useAtRest(both);
    await readable();
    expect((await raw()).every((value) => both.underPrevious(value))).toBe(
      true,
    );
    expect(await moveToCurrentKey(storage, true)).toBe(6);
    expect((await raw()).some((value) => both.underPrevious(value))).toBe(
      false,
    );
    // The previous key can go.
    useAtRest(createAtRest({ current: B, previous: null }));
    await readable();
  });

  it("leaves alone what it has no key for, and loses only those values", async () => {
    storage = await createStorage(TEST_CONFIG);
    useAtRest(createAtRest({ current: A, previous: null }));
    await fill();
    // Started with another key, and the old one not supplied.
    useAtRest(createAtRest({ current: B, previous: null }));
    expect(await moveToCurrentKey(storage, false)).toBe(0);
    const note = await storage.notes.getById("n1", "u1");
    expect(note?.reminder).toBeNull();
    // The note itself is untouched.
    expect(note?.id).toBe("n1");
    expect(await storage.serverSecrets.get("vapid")).toBeNull();
    // Given the key back, everything is there again.
    useAtRest(createAtRest({ current: B, previous: A }));
    await readable();
  });

  it("makes a server secret again, once, when the one stored does not open", async () => {
    storage = await createStorage(TEST_CONFIG);
    useAtRest(createAtRest({ current: A, previous: null }));
    await storage.serverSecrets.setIfAbsent("vapid", "first", T0);
    // The key is gone for good: what was stored reads as none.
    useAtRest(createAtRest({ current: B, previous: null }));
    expect(await storage.serverSecrets.setIfAbsent("vapid", "second", T0)).toBe(
      "second",
    );
    // Stored, so the next start and the next process hold the same one.
    expect(await storage.serverSecrets.get("vapid")).toBe("second");
    expect(await storage.serverSecrets.setIfAbsent("vapid", "third", T0)).toBe(
      "second",
    );
  });
});
