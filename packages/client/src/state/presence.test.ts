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
    recordPresenceJoin("note-1", "user-A");
    recordPresenceJoin("note-1", "user-B");
    recordPresenceJoin("note-2", "user-A");

    expect(presenceByNote.value.get("note-1")).toEqual(
      new Set(["user-A", "user-B"]),
    );
    expect(presenceByNote.value.get("note-2")).toEqual(new Set(["user-A"]));

    recordPresenceLeave("note-1", "user-A");
    expect(presenceByNote.value.get("note-1")).toEqual(new Set(["user-B"]));

    recordPresenceLeave("note-1", "user-B");
    expect(presenceByNote.value.has("note-1")).toBe(false);
  });

  it("clearPresence empties the map", () => {
    recordPresenceJoin("note-1", "user-A");
    clearPresence();
    expect(presenceByNote.value.size).toBe(0);
  });

  it("does not mutate the previous Map (signal immutability)", () => {
    recordPresenceJoin("note-1", "user-A");
    const before = presenceByNote.value;
    recordPresenceJoin("note-1", "user-B");
    expect(presenceByNote.value).not.toBe(before);
  });
});
