import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteStorage } from "../storage/sqlite/driver.js";
import type { StorageDriver } from "../storage/types.js";
import { type Broadcaster, createBroadcaster } from "../ws/broadcaster.js";
import { startTrashCleanup } from "./trashCleanup.js";

const baseNote = {
  title: "x",
  content: "y",
  color: NoteColor.Default,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: true,
  trashedAt: null as string | null,
  position: 0,
  tags: [],
  images: [],
  linkPreviews: [],
  reminder: null,
};

describe("startTrashCleanup", () => {
  let storage: StorageDriver;
  let broadcaster: Broadcaster;
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
      createdAt: new Date().toISOString(),
    });
    broadcaster = createBroadcaster();
  });

  afterEach(async () => {
    stop?.();
    await storage.close();
  });

  it("hard-deletes trashed notes older than 30 days and broadcasts note:deleted", async () => {
    const longAgo = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await storage.notes.insert({
      id: "expired",
      userId: "u1",
      data: { ...baseNote, trashed: true, trashedAt: longAgo },
      createdAt: longAgo,
      updatedAt: longAgo,
    });
    await storage.notes.insert({
      id: "fresh",
      userId: "u1",
      data: { ...baseNote, trashed: true, trashedAt: recent },
      createdAt: recent,
      updatedAt: recent,
    });

    const events: string[] = [];
    broadcaster.subscribe((_userId, event) => {
      if (event.type === "note:deleted") events.push(event.id);
    });

    stop = startTrashCleanup(storage, broadcaster, 1_000_000);

    // The cleanup runs asynchronously on startup; give it a tick.
    await new Promise((r) => setTimeout(r, 10));

    expect(await storage.notes.getById("expired", "u1")).toBeNull();
    expect(await storage.notes.getById("fresh", "u1")).not.toBeNull();
    expect(events).toEqual(["expired"]);
  });

  it("is a no-op when nothing is expired", async () => {
    const events: string[] = [];
    broadcaster.subscribe((_uid, event) => {
      if (event.type === "note:deleted") events.push(event.id);
    });
    stop = startTrashCleanup(storage, broadcaster, 1_000_000);
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual([]);
  });

  it("re-runs on the configured interval", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    broadcaster.subscribe((_uid, event) => {
      if (event.type === "note:deleted") events.push(event.id);
    });

    stop = startTrashCleanup(storage, broadcaster, 1000);

    const longAgo = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await storage.notes.insert({
      id: "later",
      userId: "u1",
      data: { ...baseNote, trashed: true, trashedAt: longAgo },
      createdAt: longAgo,
      updatedAt: longAgo,
    });
    expect(events).toEqual([]);

    await vi.advanceTimersByTimeAsync(1100);
    expect(events).toEqual(["later"]);
    vi.useRealTimers();
  });
});
