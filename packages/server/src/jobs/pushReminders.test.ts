import { createPublicKey, createVerify } from "node:crypto";
import type {
  Note,
  NoteCreate,
  NoteReminder,
  PushKeyResponse,
  ReminderPush,
  WebSocketEvent,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppHandle, createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import { hashToken } from "../lib/token.js";
import { PUSH_DROP_AFTER } from "../push/sender.js";
import { fromB64url } from "../push/webPush.js";
import { createStorage } from "../storage/index.js";
import type { StorageDriver } from "../storage/types.js";
import {
  newTestSubscription,
  startTestPushService,
  type TestPushService,
  type TestSubscription,
} from "../test/pushReceiver.js";
import { authHeaders, TEST_CONFIG } from "../test/setup.js";
import { isDueForPush, pushDueReminders } from "./pushReminders.js";

const NOW = Date.parse("2026-10-03T12:00:00Z");

const baseNote: NoteCreate = {
  title: "Dentist",
  content: "Bring the  x-rays\nand the referral",
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
  reminder: null,
};

const reminder = (overrides: Partial<NoteReminder> = {}): NoteReminder => ({
  // Two minutes before NOW.
  time: "2026-10-03T11:58:00",
  recurrence: "none",
  timezone: "UTC",
  ...overrides,
});

describe("isDueForPush", () => {
  it("waits out the grace an open app is given, and gives up after an hour", () => {
    expect(isDueForPush(reminder({ time: "2026-10-03T12:00:30" }), NOW)).toBe(
      false,
    );
    expect(isDueForPush(reminder({ time: "2026-10-03T11:59:30" }), NOW)).toBe(
      false,
    );
    expect(isDueForPush(reminder({ time: "2026-10-03T11:59:00" }), NOW)).toBe(
      true,
    );
    expect(isDueForPush(reminder({ time: "2026-10-03T11:00:30" }), NOW)).toBe(
      true,
    );
    expect(isDueForPush(reminder({ time: "2026-10-03T10:59:00" }), NOW)).toBe(
      false,
    );
  });

  it("reads the time in the reminder's own zone", () => {
    // 14:58 in Helsinki is 11:58 UTC on this day.
    const helsinki = {
      time: "2026-10-03T14:58:00",
      timezone: "Europe/Helsinki",
    };
    expect(isDueForPush(reminder(helsinki), NOW)).toBe(true);
    expect(isDueForPush(reminder({ ...helsinki, timezone: "UTC" }), NOW)).toBe(
      false,
    );
  });

  it("leaves alone what a client has already fired", () => {
    expect(
      isDueForPush(reminder({ lastFiredAt: "2026-10-03T11:58:01.000Z" }), NOW),
    ).toBe(false);
    const daily = reminder({ recurrence: "daily" });
    expect(
      isDueForPush({ ...daily, lastFiredAt: "2026-10-03T11:58:01.000Z" }, NOW),
    ).toBe(false);
    // Yesterday's fire says nothing about today's occurrence.
    expect(
      isDueForPush({ ...daily, lastFiredAt: "2026-10-02T11:58:01.000Z" }, NOW),
    ).toBe(true);
  });
});

describe("push reminders", () => {
  let storage: StorageDriver;
  let handle: AppHandle;
  let service: TestPushService;
  let browser: TestSubscription;
  let token: string;
  let userId: string;
  let events: WebSocketEvent[];

  const request = (path: string, init?: RequestInit) =>
    handle.app.request(path, init);
  const call = (method: string, path: string, body?: unknown) =>
    request(path, {
      method,
      headers: authHeaders(token),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  async function addNote(overrides: Partial<NoteCreate>): Promise<Note> {
    const res = await call("POST", "/api/notes", { ...baseNote, ...overrides });
    expect(res.status).toBe(201);
    return ((await res.json()) as { note: Note }).note;
  }

  /** A subscription at the test push service, as the route would save it. */
  async function subscribe(path = "device-1", keys = browser) {
    await storage.pushSubscriptions.save({
      id: `sub-${path}`,
      userId,
      sessionToken: hashToken(token),
      endpoint: service.endpoint(path),
      p256dh: keys.p256dh,
      auth: keys.auth,
      createdAt: "2026-10-01T00:00:00.000Z",
      failureCount: 0,
    });
  }

  const pass = (now = NOW) =>
    pushDueReminders({
      storage,
      sender: handle.pushSender,
      noteEvents: handle.noteEvents,
      now: () => now,
    });

  const reminderOf = async (id: string) =>
    ((await (await call("GET", `/api/notes/${id}`)).json()) as { note: Note })
      .note.reminder;

  beforeEach(async () => {
    service = await startTestPushService();
    browser = newTestSubscription();
    storage = await createStorage(TEST_CONFIG);
    handle = createApp({
      cfg: { ...TEST_CONFIG, appUrl: "https://notes.example" },
      storage,
      authProvider: createAuthProvider(TEST_CONFIG, storage),
      // The push service is on loopback, which no real deployment may reach.
      pushAddressPolicy: (address) => address === "127.0.0.1",
    });
    const res = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "test-pass-12" }),
    });
    const registered = (await res.json()) as {
      token: string;
      user: { id: string };
    };
    token = registered.token;
    userId = registered.user.id;
    events = [];
    handle.broadcaster.subscribe((_user, event) => events.push(event));
  });

  afterEach(async () => {
    await service.close();
    await storage.close();
  });

  it("sends a due reminder nobody fired, readable only by the browser, and marks it fired", async () => {
    const note = await addNote({ reminder: reminder() });
    await subscribe();
    await pass();

    expect(service.received).toHaveLength(1);
    const [sent] = service.received;
    expect(sent?.path).toBe("/device-1");
    expect(sent?.headers["content-encoding"]).toBe("aes128gcm");
    expect(sent?.headers.ttl).toBe("3600");
    // Nothing of the note travels in the clear.
    expect(sent?.body.toString("latin1")).not.toContain("Dentist");
    const message = JSON.parse(
      browser.decrypt(sent?.body as Buffer),
    ) as ReminderPush;
    expect(message).toEqual({
      type: "reminder",
      noteId: note.id,
      title: "Dentist",
      body: "Bring the x-rays and the referral",
      next: null,
      firedAt: "2026-10-03T12:00:00.000Z",
    });

    expect(await reminderOf(note.id)).toEqual({
      ...reminder(),
      lastFiredAt: "2026-10-03T12:00:00.000Z",
    });
    // Open clients hear the change, so none of them fires it too.
    expect(events.some((e) => e.type === "note:updated")).toBe(true);

    // And the next pass has nothing to do.
    await pass(NOW + 30_000);
    expect(service.received).toHaveLength(1);
  });

  it("signs the request with the key browsers subscribe with", async () => {
    await addNote({ reminder: reminder() });
    await subscribe();
    await pass();

    const { publicKey } = (await (
      await call("GET", "/api/push/key")
    ).json()) as PushKeyResponse;
    const header = String(service.received[0]?.headers.authorization);
    const match = /^vapid t=([\w-]+\.[\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(
      header,
    );
    expect(match?.[3]).toBe(publicKey);
    const point = fromB64url(publicKey);
    const key = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
    });
    expect(
      createVerify("SHA256")
        .update(match?.[1] ?? "")
        .verify(
          { key, dsaEncoding: "ieee-p1363" },
          fromB64url(match?.[2] ?? ""),
        ),
    ).toBe(true);
    const claims = JSON.parse(
      fromB64url((match?.[1] ?? "").split(".")[1] ?? "").toString(),
    ) as { aud: string; sub: string };
    expect(claims.aud).toBe(new URL(service.endpoint("x")).origin);
    expect(claims.sub).toBe("https://notes.example");
    // The same key on every call: it is made once and kept.
    expect(
      ((await (await call("GET", "/api/push/key")).json()) as PushKeyResponse)
        .publicKey,
    ).toBe(publicKey);
  });

  it("moves a repeating reminder to its next occurrence, and tells the browser where", async () => {
    const note = await addNote({
      title: "",
      reminder: reminder({ recurrence: "daily" }),
    });
    await subscribe();
    await pass();

    const message = JSON.parse(
      browser.decrypt(service.received[0]?.body as Buffer),
    ) as ReminderPush;
    expect(message.next).toEqual({ time: "2026-10-04T11:58:00" });
    // No title: named as the client names it, with the text as the body.
    expect(message.title).toBe("Untitled reminder");
    expect(message.body).toBe("Bring the x-rays and the referral");
    expect(await reminderOf(note.id)).toMatchObject({
      time: "2026-10-04T11:58:00",
      recurrence: "daily",
      lastFiredAt: "2026-10-03T12:00:00.000Z",
    });

    // Tomorrow it comes due again.
    await pass(NOW + 24 * 60 * 60_000);
    expect(service.received).toHaveLength(2);
  });

  it("names an untitled note in the account's language", async () => {
    await addNote({ title: " ", reminder: reminder() });
    await storage.users.setLocale(userId, "fi-FI");
    await subscribe();
    await pass();
    const message = JSON.parse(
      browser.decrypt(service.received[0]?.body as Buffer),
    ) as ReminderPush;
    expect(message.title).toBe("Nimetön muistutus");
  });

  it("sends to every browser the account has subscribed", async () => {
    await addNote({ reminder: reminder() });
    const phone = newTestSubscription();
    await subscribe("laptop");
    await subscribe("phone", phone);
    await pass();
    expect(service.received.map((r) => r.path).sort()).toEqual([
      "/laptop",
      "/phone",
    ]);
    const toPhone = service.received.find((r) => r.path === "/phone");
    expect(phone.decrypt(toPhone?.body as Buffer)).toContain("Dentist");
    expect(() => browser.decrypt(toPhone?.body as Buffer)).toThrow();
  });

  it("sends nothing for a reminder that is early, stale, fired or in the trash", async () => {
    await addNote({ reminder: reminder({ time: "2026-10-03T11:59:45" }) });
    await addNote({ reminder: reminder({ time: "2026-10-03T09:00:00" }) });
    await addNote({
      reminder: reminder({ lastFiredAt: "2026-10-03T11:58:02.000Z" }),
    });
    await addNote({ reminder: reminder(), trashed: true });
    await addNote({});
    await subscribe();
    await pass();
    expect(service.received).toEqual([]);
  });

  it("sends once when two passes read the same due reminder", async () => {
    const note = await addNote({ reminder: reminder({ recurrence: "daily" }) });
    await subscribe();
    await Promise.all([pass(), pass()]);
    expect(service.received).toHaveLength(1);
    expect((await reminderOf(note.id))?.time).toBe("2026-10-04T11:58:00");
  });

  it("leaves a reminder that changed after the pass read it", async () => {
    const note = await addNote({ reminder: reminder() });
    await subscribe();
    const later = reminder({ time: "2026-10-05T09:00:00" });
    // The user moves the reminder between the pass reading the note and
    // writing to it, as happens while an earlier send is still waiting.
    const edited: StorageDriver = {
      ...storage,
      notes: {
        ...storage.notes,
        listByUser: async (...args) => {
          const page = await storage.notes.listByUser(...args);
          const res = await call("PUT", `/api/notes/${note.id}`, {
            reminder: later,
          });
          expect(res.status).toBe(200);
          return page;
        },
      },
    };
    await pushDueReminders({
      storage: edited,
      sender: handle.pushSender,
      noteEvents: handle.noteEvents,
      now: () => NOW,
    });
    expect(service.received).toEqual([]);
    expect(await reminderOf(note.id)).toEqual(later);
  });

  it("does nothing at all for an account with no subscribed browser", async () => {
    const note = await addNote({ reminder: reminder() });
    await pass();
    expect(service.received).toEqual([]);
    // Left as it was, for the app to fire when it next opens.
    expect(await reminderOf(note.id)).toEqual(reminder());
  });

  it("forgets a subscription the push service says is gone", async () => {
    await addNote({ reminder: reminder() });
    await subscribe();
    service.status = 410;
    await pass();
    expect(await storage.pushSubscriptions.listByUser(userId)).toEqual([]);
  });

  it("drops a subscription only after it has failed many times in a row", async () => {
    await subscribe();
    service.status = 500;
    for (let i = 1; i < PUSH_DROP_AFTER; i++) {
      await addNote({ reminder: reminder() });
      await pass();
    }
    expect(
      (await storage.pushSubscriptions.listByUser(userId))[0]?.failureCount,
    ).toBe(PUSH_DROP_AFTER - 1);
    await addNote({ reminder: reminder() });
    await pass();
    expect(await storage.pushSubscriptions.listByUser(userId)).toEqual([]);
  });

  it("stops with the session the browser subscribed in", async () => {
    await addNote({ reminder: reminder() });
    await subscribe();
    const res = await call("POST", "/api/auth/logout");
    expect(res.status).toBe(204);
    await pass();
    expect(service.received).toEqual([]);
    expect(await storage.pushSubscriptions.userIds()).toEqual([]);
  });
});

describe("/api/push", () => {
  let storage: StorageDriver;
  let handle: AppHandle;
  let token: string;
  let userId: string;

  const boot = async (cfg = TEST_CONFIG) => {
    storage = await createStorage(cfg);
    handle = createApp({
      cfg,
      storage,
      authProvider: createAuthProvider(cfg, storage),
    });
    const res = await handle.app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "test-pass-12" }),
    });
    const registered = (await res.json()) as {
      token: string;
      user: { id: string };
    };
    token = registered.token;
    userId = registered.user.id;
  };

  const call = (method: string, path: string, body?: unknown, as = token) =>
    handle.app.request(path, {
      method,
      headers: authHeaders(as),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  const subscription = (name: string, keys = newTestSubscription()) => ({
    endpoint: `https://push.example/send/${name}`,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  });

  afterEach(async () => {
    await storage.close();
  });

  it("takes a browser's subscription, once per endpoint, and lets it go", async () => {
    await boot();
    const first = subscription("laptop");
    expect((await call("POST", "/api/push/subscriptions", first)).status).toBe(
      204,
    );
    expect(
      (await call("POST", "/api/push/subscriptions", subscription("laptop")))
        .status,
    ).toBe(204);
    const held = await storage.pushSubscriptions.listByUser(userId);
    expect(held).toHaveLength(1);
    expect(held[0]?.sessionToken).toBe(hashToken(token));

    expect(
      (
        await call("DELETE", "/api/push/subscriptions", {
          endpoint: first.endpoint,
        })
      ).status,
    ).toBe(204);
    expect(await storage.pushSubscriptions.listByUser(userId)).toEqual([]);
  });

  it("refuses an endpoint that is not https, and keys that are not a subscription's", async () => {
    await boot();
    const good = subscription("x");
    expect(
      (
        await call("POST", "/api/push/subscriptions", {
          ...good,
          endpoint: "http://push.example/send/x",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("POST", "/api/push/subscriptions", {
          ...good,
          keys: { p256dh: "AAAA", auth: good.keys.auth },
        })
      ).status,
    ).toBe(422);
  });

  it("keeps only the newest subscriptions of an account", async () => {
    await boot();
    for (let i = 0; i < 12; i++) {
      await call("POST", "/api/push/subscriptions", subscription(`d${i}`));
    }
    const held = await storage.pushSubscriptions.listByUser(userId);
    expect(held).toHaveLength(10);
    expect(held.some((s) => s.endpoint.endsWith("/d0"))).toBe(false);
    expect(held.some((s) => s.endpoint.endsWith("/d11"))).toBe(true);
  });

  it("is for a session, not a token", async () => {
    await boot();
    const minted = await call("POST", "/api/tokens", {
      name: "script",
      password: "test-pass-12",
    });
    const { secret } = (await minted.json()) as { secret: string };
    expect((await call("GET", "/api/push/key", undefined, secret)).status).toBe(
      403,
    );
  });

  it("is not there with WEB_PUSH off, though a subscription can still be removed", async () => {
    await boot({ ...TEST_CONFIG, pushReminders: false });
    expect((await call("GET", "/api/push/key")).status).toBe(404);
    expect(
      (await call("POST", "/api/push/subscriptions", subscription("x"))).status,
    ).toBe(404);
    expect(
      (
        await call("DELETE", "/api/push/subscriptions", {
          endpoint: "https://push.example/send/x",
        })
      ).status,
    ).toBe(204);
  });
});
