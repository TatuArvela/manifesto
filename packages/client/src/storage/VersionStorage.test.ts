import { compressToUTF16, decompressFromUTF16 } from "lz-string";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteVersions, getVersions, saveVersion } from "./VersionStorage.js";

const STORAGE_KEY = "manifesto:versions";

describe("VersionStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("saves and retrieves a version", () => {
    saveVersion("note1", "Title", "Content");
    const versions = getVersions("note1");
    expect(versions).toHaveLength(1);
    expect(versions[0].noteId).toBe("note1");
    expect(versions[0].title).toBe("Title");
    expect(versions[0].content).toBe("Content");
    expect(versions[0].timestamp).toBeTruthy();
  });

  it("returns versions newest first", () => {
    saveVersion("note1", "First", "A");
    saveVersion("note1", "Second", "B");
    saveVersion("note1", "Third", "C");
    const versions = getVersions("note1");
    expect(versions).toHaveLength(3);
    expect(versions[0].title).toBe("Third");
    expect(versions[1].title).toBe("Second");
    expect(versions[2].title).toBe("First");
  });

  it("caps at 50 versions per note", () => {
    for (let i = 0; i < 60; i++) {
      saveVersion("note1", `Title ${i}`, `Content ${i}`);
    }
    const versions = getVersions("note1");
    expect(versions).toHaveLength(50);
    // Newest should be the last one saved
    expect(versions[0].title).toBe("Title 59");
    // Oldest kept should be #10 (0-9 were dropped)
    expect(versions[49].title).toBe("Title 10");
  });

  it("prunes versions older than 90 days", () => {
    // Manually insert an old version by manipulating storage
    saveVersion("note1", "Recent", "Content");

    // Read, modify timestamp, write back
    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    const map = JSON.parse(decompressFromUTF16(raw) ?? "{}");
    const oldDate = new Date(
      Date.now() - 91 * 24 * 60 * 60 * 1000,
    ).toISOString();
    map.note1.unshift({
      noteId: "note1",
      timestamp: oldDate,
      title: "Old",
      content: "Old content",
    });
    localStorage.setItem(STORAGE_KEY, compressToUTF16(JSON.stringify(map)));

    // Saving a new version should prune the old one
    saveVersion("note1", "New", "New content");
    const versions = getVersions("note1");
    expect(versions.every((v) => v.title !== "Old")).toBe(true);
  });

  it("deleteVersions removes all versions for a note", () => {
    saveVersion("note1", "A", "A");
    saveVersion("note2", "B", "B");
    deleteVersions("note1");
    expect(getVersions("note1")).toHaveLength(0);
    expect(getVersions("note2")).toHaveLength(1);
  });

  it("deleteVersions is a no-op for unknown note", () => {
    saveVersion("note1", "A", "A");
    deleteVersions("unknown");
    expect(getVersions("note1")).toHaveLength(1);
  });

  it("stores data compressed (not raw JSON)", () => {
    saveVersion("note1", "Title", "Content");
    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    // Compressed data should not be valid JSON
    expect(() => JSON.parse(raw)).toThrow();
  });

  it("versions for different notes are independent", () => {
    saveVersion("note1", "A", "A");
    saveVersion("note2", "B", "B");
    saveVersion("note1", "C", "C");
    expect(getVersions("note1")).toHaveLength(2);
    expect(getVersions("note2")).toHaveLength(1);
  });

  it("returns empty array for note with no versions", () => {
    expect(getVersions("nonexistent")).toHaveLength(0);
  });

  it("handles empty/corrupt storage gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "corrupt data");
    expect(getVersions("note1")).toHaveLength(0);
    // Should still be able to save after corruption
    saveVersion("note1", "A", "A");
    expect(getVersions("note1")).toHaveLength(1);
  });
});
