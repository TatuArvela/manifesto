import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteStorage } from "../storage/sqlite/driver.js";
import type { StorageDriver } from "../storage/types.js";
import { startSessionCleanup } from "./sessionCleanup.js";
import { isoMinusDays, isoPlusDays, nowIso } from "./time.js";
import { hashToken } from "./token.js";

describe("startSessionCleanup", () => {
  let storage: StorageDriver;
  let stop: () => void;

  beforeEach(async () => {
    storage = createSqliteStorage({ dbPath: ":memory:" });
    await storage.users.create({
      id: "u1",
      username: "alice",
      passwordHash: "h",
      displayName: "",
      avatarColor: "",
      provider: "local",
      externalId: null,
      createdAt: nowIso(),
    });
  });

  afterEach(async () => {
    stop?.();
    await storage.close();
  });

  async function seed(token: string, expiresAt: string): Promise<void> {
    await storage.sessions.create({
      token: hashToken(token),
      userId: "u1",
      createdAt: isoMinusDays(1),
      expiresAt,
      lastSeenAt: nowIso(),
    });
  }

  it("deletes expired sessions and leaves live ones", async () => {
    await seed("stale", isoMinusDays(1));
    await seed("live", isoPlusDays(1));

    stop = startSessionCleanup({
      storage,
      auditRetentionDays: 180,
      intervalMs: 1_000_000,
    });
    // The sweep runs asynchronously on startup; give it a tick.
    await new Promise((r) => setTimeout(r, 10));

    expect(await storage.sessions.findByToken(hashToken("stale"))).toBeNull();
    expect(
      await storage.sessions.findByToken(hashToken("live")),
    ).not.toBeNull();
  });

  it("re-runs on the configured interval", async () => {
    vi.useFakeTimers();
    stop = startSessionCleanup({
      storage,
      auditRetentionDays: 180,
      intervalMs: 1000,
    });
    await seed("stale", isoMinusDays(1));
    expect(
      await storage.sessions.findByToken(hashToken("stale")),
    ).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1100);
    expect(await storage.sessions.findByToken(hashToken("stale"))).toBeNull();
    vi.useRealTimers();
  });
});
