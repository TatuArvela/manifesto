import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, StoredPushSubscription } from "../types.js";

/**
 * Push subscriptions and the server's own secrets, the same in both drivers:
 * an endpoint belongs to whoever saved it last, failures are counted and
 * cleared, and a secret is made once.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-02T00:00:00.000Z";

function subscription(
  overrides: Partial<StoredPushSubscription> = {},
): StoredPushSubscription {
  return {
    id: "s1",
    userId: "u1",
    sessionToken: "session-u1",
    endpoint: "https://push.example/send/one",
    p256dh: "key",
    auth: "secret",
    createdAt: T0,
    failureCount: 0,
    ...overrides,
  };
}

export function describePushContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: web push`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      for (const id of ["u1", "u2"]) {
        await storage.users.create({
          id,
          username: id,
          passwordHash: "h",
          displayName: "",
          avatarColor: "#123456",
          provider: "local",
          externalId: null,
          createdAt: T0,
        });
        await storage.sessions.create({
          token: `session-${id}`,
          userId: id,
          createdAt: T0,
          expiresAt: "2999-01-01T00:00:00.000Z",
          lastSeenAt: T0,
        });
      }
    });

    afterEach(async () => {
      await storage.close();
    });

    it("keeps each user's subscriptions, oldest first", async () => {
      await storage.pushSubscriptions.save(
        subscription({
          id: "s2",
          endpoint: "https://push.example/send/two",
          createdAt: T1,
        }),
      );
      await storage.pushSubscriptions.save(subscription());
      await storage.pushSubscriptions.save(
        subscription({
          id: "s3",
          userId: "u2",
          sessionToken: "session-u2",
          endpoint: "https://push.example/send/three",
        }),
      );
      expect(
        (await storage.pushSubscriptions.listByUser("u1")).map((s) => s.id),
      ).toEqual(["s1", "s2"]);
      expect((await storage.pushSubscriptions.userIds()).sort()).toEqual([
        "u1",
        "u2",
      ]);
      expect((await storage.pushSubscriptions.listByUser("u1"))[0]).toEqual(
        subscription(),
      );
    });

    it("gives an endpoint to whoever saved it last", async () => {
      await storage.pushSubscriptions.save(subscription());
      await storage.pushSubscriptions.save(
        subscription({
          id: "s9",
          userId: "u2",
          sessionToken: "session-u2",
          p256dh: "new",
        }),
      );
      expect(await storage.pushSubscriptions.listByUser("u1")).toEqual([]);
      expect(await storage.pushSubscriptions.listByUser("u2")).toEqual([
        subscription({
          id: "s9",
          userId: "u2",
          sessionToken: "session-u2",
          p256dh: "new",
        }),
      ]);
    });

    it("removes a subscription by its endpoint only for its own user", async () => {
      await storage.pushSubscriptions.save(subscription());
      const { endpoint } = subscription();
      expect(
        await storage.pushSubscriptions.deleteByEndpoint(endpoint, "u2"),
      ).toBe(false);
      expect(
        await storage.pushSubscriptions.deleteByEndpoint(endpoint, "u1"),
      ).toBe(true);
      expect(await storage.pushSubscriptions.userIds()).toEqual([]);
    });

    it("counts failures in a row, and a success clears them", async () => {
      await storage.pushSubscriptions.save(subscription());
      expect(await storage.pushSubscriptions.recordFailure("s1")).toBe(1);
      expect(await storage.pushSubscriptions.recordFailure("s1")).toBe(2);
      await storage.pushSubscriptions.recordSuccess("s1");
      expect(
        (await storage.pushSubscriptions.listByUser("u1"))[0]?.failureCount,
      ).toBe(0);
      expect(await storage.pushSubscriptions.recordFailure("nope")).toBe(0);
    });

    it("drops a user's subscriptions on request, and with the account", async () => {
      await storage.pushSubscriptions.save(subscription());
      await storage.pushSubscriptions.save(
        subscription({
          id: "s3",
          userId: "u2",
          sessionToken: "session-u2",
          endpoint: "https://push.example/send/three",
        }),
      );
      expect(await storage.pushSubscriptions.deleteByUser("u1")).toBe(1);
      expect(await storage.pushSubscriptions.delete("nope")).toBe(false);
      await storage.users.delete("u2");
      expect(await storage.pushSubscriptions.userIds()).toEqual([]);
    });

    it("ends with the session it was made in", async () => {
      await storage.pushSubscriptions.save(subscription());
      await storage.pushSubscriptions.save(
        subscription({
          id: "s3",
          userId: "u2",
          sessionToken: "session-u2",
          endpoint: "https://push.example/send/three",
        }),
      );
      await storage.sessions.deleteByUser("u1");
      expect(await storage.pushSubscriptions.userIds()).toEqual(["u2"]);
      await storage.sessions.deleteExpired("2999-06-01T00:00:00.000Z");
      expect(await storage.pushSubscriptions.userIds()).toEqual([]);
    });

    it("makes a server secret once", async () => {
      expect(await storage.serverSecrets.get("vapid")).toBeNull();
      expect(
        await storage.serverSecrets.setIfAbsent("vapid", "first", T0),
      ).toBe("first");
      expect(
        await storage.serverSecrets.setIfAbsent("vapid", "second", T1),
      ).toBe("first");
      expect(await storage.serverSecrets.get("vapid")).toBe("first");
    });
  });
}
