import { compressToUTF16, decompressFromUTF16 } from "lz-string";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteVersions,
  getVersions,
  resetVersionMigrationForTests,
  saveVersion,
} from "./VersionStorage.js";

const LEGACY_KEY = "manifesto:versions";
const keyFor = (noteId: string) => `manifesto:versions:${noteId}`;

describe("VersionStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    resetVersionMigrationForTests();
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
    const raw = localStorage.getItem(keyFor("note1")) ?? "";
    const list = JSON.parse(decompressFromUTF16(raw) ?? "[]");
    const oldDate = new Date(
      Date.now() - 91 * 24 * 60 * 60 * 1000,
    ).toISOString();
    list.unshift({
      noteId: "note1",
      timestamp: oldDate,
      title: "Old",
      content: "Old content",
    });
    localStorage.setItem(
      keyFor("note1"),
      compressToUTF16(JSON.stringify(list)),
    );

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
    const raw = localStorage.getItem(keyFor("note1")) ?? "";
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

  it("keeps each note's history under a key of its own", () => {
    // Saving one note's version must not rewrite anyone else's: the shared
    // map this replaced made closing the editor cost the whole history.
    saveVersion("note1", "A", "A");
    const other = compressToUTF16(JSON.stringify([]));
    localStorage.setItem(keyFor("note2"), other);
    saveVersion("note1", "B", "B");
    expect(localStorage.getItem(keyFor("note2"))).toBe(other);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("returns empty array for note with no versions", () => {
    expect(getVersions("nonexistent")).toHaveLength(0);
  });

  it("handles empty/corrupt storage gracefully", () => {
    localStorage.setItem(keyFor("note1"), "corrupt data");
    expect(getVersions("note1")).toHaveLength(0);
    // Should still be able to save after corruption
    saveVersion("note1", "A", "A");
    expect(getVersions("note1")).toHaveLength(1);
  });
});

describe("VersionStorage legacy migration", () => {
  beforeEach(() => {
    localStorage.clear();
    resetVersionMigrationForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const version = (noteId: string, title: string) => ({
    noteId,
    timestamp: new Date().toISOString(),
    title,
    content: title,
  });

  it("splits the shared map into per-note keys and drops it", () => {
    localStorage.setItem(
      LEGACY_KEY,
      compressToUTF16(
        JSON.stringify({
          note1: [version("note1", "A"), version("note1", "B")],
          note2: [version("note2", "C")],
        }),
      ),
    );

    expect(getVersions("note1").map((v) => v.title)).toEqual(["B", "A"]);
    expect(getVersions("note2").map((v) => v.title)).toEqual(["C"]);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("frees the shared key's space when the split runs out of room", () => {
    localStorage.setItem(
      LEGACY_KEY,
      compressToUTF16(JSON.stringify({ note1: [version("note1", "A")] })),
    );
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      // Full for as long as the shared key is still taking up room.
      if (this.getItem(LEGACY_KEY) !== null) {
        throw new DOMException("full", "QuotaExceededError");
      }
      real.call(this, key, value);
    });

    expect(getVersions("note1").map((v) => v.title)).toEqual(["A"]);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("drops a corrupt shared map rather than keeping it", () => {
    localStorage.setItem(LEGACY_KEY, "corrupt data");
    expect(getVersions("note1")).toHaveLength(0);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

describe("VersionStorage quota fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    resetVersionMigrationForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function seed(noteId: string, versions: unknown[]): void {
    localStorage.setItem(
      keyFor(noteId),
      compressToUTF16(JSON.stringify(versions)),
    );
  }

  function version(noteId: string, title: string) {
    return {
      noteId,
      timestamp: new Date().toISOString(),
      title,
      content: title,
    };
  }

  /** Throws QuotaExceededError once, then behaves normally. */
  function failFirstSetItem(): void {
    const real = Storage.prototype.setItem;
    let thrown = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (!thrown) {
        thrown = true;
        throw new DOMException("full", "QuotaExceededError");
      }
      real.call(this, key, value);
    });
  }

  it("gives up the note's oldest version to make room for the new one", () => {
    seed("multi", [version("multi", "First"), version("multi", "Second")]);
    seed("solo", [version("solo", "Only")]);
    failFirstSetItem();

    saveVersion("multi", "Third", "Third");

    expect(getVersions("multi").map((v) => v.title)).toEqual([
      "Third",
      "Second",
    ]);
    // Another note's history is never what pays for this one.
    expect(getVersions("solo").map((v) => v.title)).toEqual(["Only"]);
  });
});
