import type { NoteVersion } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentStorage, storageConnection } from "../storage/index.js";
import { getVersions, saveVersion } from "../storage/VersionStorage.js";
import { loadVersions, recordVersion } from "./versions.js";

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
