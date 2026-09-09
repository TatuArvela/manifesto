import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isoMinusDays, isoPlusDays, nowIso } from "../lib/time.js";
import { hashToken } from "../lib/token.js";
import { createSqliteStorage } from "../storage/sqlite/driver.js";
import type { StorageDriver } from "../storage/types.js";
import { TEST_CONFIG } from "../test/setup.js";
import { authenticateBySession, issueSession } from "./session.js";

const CFG = {
  sessionTtlDays: TEST_CONFIG.sessionTtlDays,
  sessionAbsoluteTtlDays: TEST_CONFIG.sessionAbsoluteTtlDays,
};

describe("session lifetime", () => {
  let storage: StorageDriver;

  beforeEach(async () => {
    storage = createSqliteStorage({ dbPath: ":memory:" });
    await storage.users.create({
      id: "u1",
      username: "alice",
      passwordHash: "h",
      displayName: "Alice",
      avatarColor: "#000",
      provider: "local",
      externalId: null,
      createdAt: nowIso(),
    });
  });

  afterEach(async () => {
    await storage.close();
  });

  /**
   * A session minted `daysAgo` days ago and still live: its sliding expiry is
   * a day out, which is what the next authenticated request pushes forward.
   */
  async function seedSession(daysAgo: number): Promise<string> {
    const token = "raw-token-for-tests";
    await storage.sessions.create({
      token: hashToken(token),
      userId: "u1",
      createdAt: isoMinusDays(daysAgo),
      expiresAt: isoPlusDays(1),
      lastSeenAt: nowIso(),
    });
    return token;
  }

  it("slides the expiry forward on use", async () => {
    const token = await seedSession(1);
    const identity = await authenticateBySession(storage, CFG, token);
    expect(identity?.userId).toBe("u1");
    const after = await storage.sessions.findByToken(hashToken(token));
    // A full inactivity window out, not the day it had left.
    expect(
      after?.expiresAt.localeCompare(isoPlusDays(CFG.sessionTtlDays - 1)),
    ).toBe(1);
  });

  it("refuses a session past its absolute lifetime however recently it was used", async () => {
    // Kept warm the whole time — its sliding expiry is still in the future.
    const token = await seedSession(CFG.sessionAbsoluteTtlDays + 1);
    expect(await authenticateBySession(storage, CFG, token)).toBeNull();
    // And the row is gone, not merely refused.
    expect(await storage.sessions.findByToken(hashToken(token))).toBeNull();
  });

  it("never slides an expiry past the absolute end", async () => {
    // One day short of the cap, so a full sliding window would overshoot it.
    const token = await seedSession(CFG.sessionAbsoluteTtlDays - 1);
    await authenticateBySession(storage, CFG, token);
    const session = await storage.sessions.findByToken(hashToken(token));
    const absoluteEnd = isoPlusDays(
      CFG.sessionAbsoluteTtlDays,
      new Date(session?.createdAt ?? ""),
    );
    expect(session?.expiresAt).toBe(absoluteEnd);
    // Which is well inside what the inactivity timeout alone would have given.
    expect(session?.expiresAt.localeCompare(isoPlusDays(2))).toBe(-1);
  });

  it("treats a session with an unparseable createdAt as expired", async () => {
    const token = "corrupt-row-token";
    await storage.sessions.create({
      token: hashToken(token),
      userId: "u1",
      createdAt: "not-a-date",
      expiresAt: isoPlusDays(CFG.sessionTtlDays),
      lastSeenAt: nowIso(),
    });
    expect(await authenticateBySession(storage, CFG, token)).toBeNull();
  });

  it("caps a freshly issued session at the absolute lifetime", async () => {
    const shortCap = { sessionTtlDays: 30, sessionAbsoluteTtlDays: 1 };
    const { expiresAt } = await issueSession(storage, shortCap, "u1");
    expect(expiresAt.localeCompare(isoPlusDays(2))).toBe(-1);
  });
});
