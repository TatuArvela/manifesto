import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver, WebhookDeliveryResult } from "#/storage/types.ts";

/**
 * The record of webhook deliveries, the same in both drivers: failures in
 * sequence are counted, a success clears the count, and the webhook switches
 * off at `disableAfter` failures.
 */

const T0 = "2026-04-01T00:00:00.000Z";

function delivery(failed: boolean): WebhookDeliveryResult {
  return {
    at: T0,
    status: failed ? 500 : 200,
    error: failed ? "Server error" : null,
    failed,
    disableAfter: 3,
  };
}

export function describeWebhooksContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: webhook deliveries`, () => {
    let storage: StorageDriver;
    const state = async () => {
      const hook = await storage.webhooks.get("w1", "u1");
      return { active: hook?.active, failureCount: hook?.failureCount };
    };

    beforeEach(async () => {
      storage = await boot();
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
      await storage.webhooks.create({
        id: "w1",
        userId: "u1",
        url: "https://hooks.example/one",
        secret: "secret",
        events: ["note.created"],
        active: true,
        createdAt: T0,
        lastDeliveryAt: null,
        lastStatus: null,
        lastError: null,
        failureCount: 0,
      });
    });

    afterEach(async () => {
      await storage.close();
    });

    it("counts failures, and a success clears the count", async () => {
      await storage.webhooks.recordDelivery("w1", delivery(true));
      await storage.webhooks.recordDelivery("w1", delivery(true));
      expect(await state()).toEqual({ active: true, failureCount: 2 });
      await storage.webhooks.recordDelivery("w1", delivery(false));
      expect(await state()).toEqual({ active: true, failureCount: 0 });
    });

    it("switches off at `disableAfter` failures in sequence", async () => {
      for (let i = 0; i < 3; i++) {
        await storage.webhooks.recordDelivery("w1", delivery(true));
      }
      expect(await state()).toEqual({ active: false, failureCount: 3 });
      const hook = await storage.webhooks.get("w1", "u1");
      expect(hook?.lastStatus).toBe(500);
      expect(hook?.lastError).toBe("Server error");
    });
  });
}
