import { afterEach, describe, expect, it } from "vitest";
import {
  clearPresence,
  presenceByNote,
  recordPresenceJoin,
  recordPresenceLeave,
} from "./presence.js";

describe("presence signal", () => {
  afterEach(() => {
    clearPresence();
  });

  it("starts empty", () => {
    expect(presenceByNote.value.size).toBe(0);
  });

  it("records and removes viewers per note", () => {
    const userA = { id: "user-A", displayName: "Alice", avatarColor: "#abc" };
    const userB = { id: "user-B", displayName: "Bob", avatarColor: "#cde" };

    recordPresenceJoin("note-1", userA);
    recordPresenceJoin("note-1", userB);
    recordPresenceJoin("note-2", userA);

    expect([...(presenceByNote.value.get("note-1")?.keys() ?? [])]).toEqual([
      "user-A",
      "user-B",
    ]);
    expect(presenceByNote.value.get("note-1")?.get("user-A")).toEqual(userA);
    expect([...(presenceByNote.value.get("note-2")?.keys() ?? [])]).toEqual([
      "user-A",
    ]);

    recordPresenceLeave("note-1", "user-A");
    expect([...(presenceByNote.value.get("note-1")?.keys() ?? [])]).toEqual([
      "user-B",
    ]);

    recordPresenceLeave("note-1", "user-B");
    expect(presenceByNote.value.has("note-1")).toBe(false);
  });

  it("clearPresence empties the map", () => {
    recordPresenceJoin("note-1", {
      id: "user-A",
      displayName: "A",
      avatarColor: "",
    });
    clearPresence();
    expect(presenceByNote.value.size).toBe(0);
  });

  it("does not mutate the previous Map (signal immutability)", () => {
    recordPresenceJoin("note-1", {
      id: "user-A",
      displayName: "A",
      avatarColor: "",
    });
    const before = presenceByNote.value;
    recordPresenceJoin("note-1", {
      id: "user-B",
      displayName: "B",
      avatarColor: "",
    });
    expect(presenceByNote.value).not.toBe(before);
  });
});
