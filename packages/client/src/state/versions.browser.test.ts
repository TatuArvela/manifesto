import type { NoteVersion } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentStorage, storageConnection } from "../storage/index.js";
import { getVersions, saveVersion } from "../storage/VersionStorage.js";
import { notes } from "./notesStore.js";
import { loadVersions, recordVersion, restoreVersions } from "./versions.js";

let saved: { noteId: string; timestamp?: string; content: string }[];
let listVersions: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  saved = [];
  listVersions = vi.fn(async (): Promise<NoteVersion[]> => []);
  vi.spyOn(currentStorage, "value", "get").mockReturnValue({
    listVersions,
    saveVersion: async (
      noteId: string,
      v: { content: string; timestamp?: string },
    ) => {
      saved.push({ noteId, ...v });
    },
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  storageConnection.value = { serverUrl: null, token: null };
  localStorage.clear();
});

describe("versions in connected mode", () => {
  it("sends a browser's own history across once, oldest first, then drops it", async () => {
    saveVersion("n1", "", "first");
    saveVersion("n1", "", "second");
    storageConnection.value = { serverUrl: "", token: "t" };

    await loadVersions("n1");
    expect(saved.map((v) => v.content)).toEqual(["first", "second"]);
    expect(saved.every((v) => typeof v.timestamp === "string")).toBe(true);
    expect(getVersions("n1")).toEqual([]);

    await loadVersions("n1");
    expect(saved).toHaveLength(2);
    expect(listVersions).toHaveBeenCalledTimes(2);
  });

  it("leaves open mode's history where it is", async () => {
    saveVersion("n1", "", "kept");
    await loadVersions("n1");
    expect(saved).toEqual([]);
  });

  it("reads a failure as no history and never rejects", async () => {
    listVersions.mockRejectedValue(new Error("offline"));
    expect(await loadVersions("n1")).toBeNull();
    vi.spyOn(currentStorage, "value", "get").mockReturnValue({
      saveVersion: async () => {
        throw new Error("offline");
      },
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordVersion("n1", "", "x")).resolves.toBeUndefined();
  });
});

describe("restoreVersions", () => {
  const ago = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const version = (noteId: string, content: string, timestamp: string) => ({
    noteId,
    title: "",
    content,
    timestamp,
  });

  afterEach(() => {
    notes.value = [];
  });

  it("files an export's history under the notes it imported, oldest first", async () => {
    notes.value = [
      { id: "mine" },
      { id: "theirs", sharing: { role: "edit" } },
    ] as never;
    const heldAt = ago(3);
    listVersions.mockResolvedValue([version("mine", "held", heldAt)]);

    await restoreVersions([
      version("mine", "newer", ago(1)),
      version("mine", "held", heldAt),
      version("mine", "older", ago(2)),
      version("mine", "expired", ago(10_000)),
      version("theirs", "not mine to add", ago(1)),
      version("gone", "no such note", ago(1)),
    ]);

    expect(saved.map((v) => v.content)).toEqual(["older", "newer"]);
    expect(saved.every((v) => v.noteId === "mine" && v.timestamp)).toBe(true);
  });

  it("never rejects when the history cannot be filed", async () => {
    notes.value = [{ id: "mine" }] as never;
    listVersions.mockRejectedValue(new Error("offline"));
    await expect(
      restoreVersions([version("mine", "x", ago(1))]),
    ).resolves.toBeUndefined();
  });
});
