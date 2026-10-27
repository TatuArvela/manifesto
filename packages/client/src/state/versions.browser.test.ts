import type { NoteVersion } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentStorage, storageConnection } from "#/storage/index.ts";
import {
  getVersions,
  saveVersion,
  versionImageRefs,
} from "#/storage/VersionStorage.ts";
import { notes } from "./notesStore.ts";
import {
  loadVersions,
  recordVersion,
  restoreVersions,
  versionToKeep,
} from "./versions.ts";

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
    await expect(
      recordVersion("n1", { title: "", content: "x" }),
    ).resolves.toBeUndefined();
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

describe("the images of a version", () => {
  const note = (images: string[], imageAlts?: string[]) =>
    ({
      id: "n1",
      title: "T",
      content: "C",
      images,
      ...(imageAlts && { imageAlts }),
    }) as never;

  it("keeps the images from before, when only the images changed", () => {
    notes.value = [note(["local:new"])];
    const version = versionToKeep(
      "n1",
      { title: "T", content: "C", images: { images: ["local:old"] } },
      "T",
      "C",
    );
    expect(version).toEqual({
      title: "T",
      content: "C",
      images: ["local:old"],
    });
  });

  it("sees a new description as a change, and nothing when all is the same", () => {
    notes.value = [note(["local:a"], ["A dog"])];
    const before = {
      title: "T",
      content: "C",
      images: { images: ["local:a"] },
    };
    expect(versionToKeep("n1", before, "T", "C")).not.toBeNull();
    notes.value = [note(["local:a"])];
    expect(versionToKeep("n1", before, "T", "C")).toBeNull();
  });

  it("keeps no images when they had not arrived", () => {
    notes.value = [note(["local:a"])];
    expect(
      versionToKeep("n1", { title: "T", content: "C", images: null }, "T", "D"),
    ).toEqual({ title: "T", content: "C" });
  });

  it("names the images of open mode's versions for the sweep", () => {
    saveVersion("n1", "", "kept", undefined, { images: ["local:old"] });
    saveVersion("n2", "", "plain");
    expect(versionImageRefs()).toEqual(["local:old"]);
    expect(getVersions("n1")[0]?.images).toEqual(["local:old"]);
  });
});
