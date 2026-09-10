import { describe, expect, it } from "vitest";
import { isServerEvent } from "./appSocket.js";

/**
 * The wire is untrusted input like any other. This guard used to accept
 * anything carrying a string `type`, which narrowed it to the union without
 * checking the fields the branches then read — a `note:created` with no note
 * put `undefined` into the list and a card threw during render, the same
 * failure as an unknown colour in an imported file.
 *
 * The guard itself is pure, but importing it reaches `state/prefs.ts`, which
 * touches `document` as it loads — so this belongs in the browser project.
 */
describe("isServerEvent", () => {
  const note = { id: "01J", title: "T", content: "" };
  const user = { id: "u1", displayName: "Ada", avatarColor: "#fff" };

  it.each([
    ["note:created", { type: "note:created", note }],
    ["note:updated", { type: "note:updated", note }],
    ["note:deleted", { type: "note:deleted", id: "01J" }],
    ["presence:join", { type: "presence:join", noteId: "01J", user }],
    ["presence:leave", { type: "presence:leave", noteId: "01J", userId: "u1" }],
  ])("accepts a well-formed %s", (_name, event) => {
    expect(isServerEvent(event)).toBe(true);
  });

  it.each([
    ["a type it does not know", { type: "note:exploded", note }],
    ["a note event with no note", { type: "note:created" }],
    ["a note event whose note has no id", { type: "note:updated", note: {} }],
    ["a note event whose note is null", { type: "note:created", note: null }],
    ["a delete with no id", { type: "note:deleted" }],
    ["a delete whose id is a number", { type: "note:deleted", id: 7 }],
    ["a join with no user", { type: "presence:join", noteId: "01J" }],
    [
      "a join whose user is missing a field",
      { type: "presence:join", noteId: "01J", user: { id: "u1" } },
    ],
    ["a leave with no userId", { type: "presence:leave", noteId: "01J" }],
    ["no type at all", { note }],
    ["null", null],
    ["a string", "note:created"],
    ["an array", []],
  ])("rejects %s", (_name, event) => {
    expect(isServerEvent(event)).toBe(false);
  });
});
