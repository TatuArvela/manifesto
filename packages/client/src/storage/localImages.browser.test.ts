import { isLocalImageRef, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "./LocalStorageAdapter.js";
import {
  clearLocalImages,
  getLocalImage,
  putLocalImage,
  sweepLocalImages,
} from "./localImages.js";

const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const gifBlob = () =>
  new Blob([Uint8Array.from(atob(GIF.slice(22)), (c) => c.charCodeAt(0))], {
    type: "image/gif",
  });

describe("open mode's image store", () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearLocalImages();
  });
  afterEach(async () => {
    localStorage.clear();
    await clearLocalImages();
  });

  it("stores an image once, by its content, and gives it back", async () => {
    const a = await putLocalImage(gifBlob());
    const b = await putLocalImage(gifBlob());
    expect(isLocalImageRef(a)).toBe(true);
    expect(b).toBe(a);
    const back = await getLocalImage(a);
    expect(back.type).toBe("image/gif");
    expect(back.size).toBe(gifBlob().size);
  });

  it("sweeps only unreferenced images past the grace", async () => {
    const ref = await putLocalImage(gifBlob());
    expect(await sweepLocalImages(new Set(), 60_000)).toBe(0);
    expect(await sweepLocalImages(new Set([ref]), 0, Date.now() + 1)).toBe(0);
    expect(await sweepLocalImages(new Set(), 0, Date.now() + 1)).toBe(1);
    await expect(getLocalImage(ref)).rejects.toThrow();
  });

  it("keeps a note's images out of localStorage", async () => {
    const adapter = new LocalStorageAdapter();
    const note = await adapter.create({
      title: "",
      content: "",
      color: NoteColor.Default,
      font: NoteFont.Default,
      pinned: false,
      archived: false,
      trashed: false,
      trashedAt: null,
      position: 0,
      tags: [],
      images: [GIF],
      linkPreviews: [],
      reminder: null,
    });
    expect(isLocalImageRef(note.images[0])).toBe(true);
    expect(localStorage.getItem("manifesto:notes")).not.toContain("data:");
    expect((await adapter.loadImage(note.images[0])).type).toBe("image/gif");
  });

  it("moves images a note held inline before, on first load", async () => {
    localStorage.setItem(
      "manifesto:notes",
      JSON.stringify([
        {
          id: "01OLD",
          title: "Old",
          content: "",
          color: "default",
          font: "default",
          pinned: false,
          archived: false,
          trashed: false,
          trashedAt: null,
          position: 0,
          tags: [],
          images: [GIF],
          linkPreviews: [],
          reminder: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    const [note] = await new LocalStorageAdapter().getAll();
    expect(isLocalImageRef(note.images[0])).toBe(true);
    expect(localStorage.getItem("manifesto:notes")).not.toContain("data:");
  });
  it("keeps a note's images inline, and loads the board, when they cannot move", async () => {
    const broken = "data:image/gif;base64,%%%not-base64%%%";
    const stored = (id: string, image: string) => ({
      id,
      title: id,
      content: "",
      color: "default",
      font: "default",
      pinned: false,
      archived: false,
      trashed: false,
      trashedAt: null,
      position: 0,
      tags: [],
      images: [image],
      linkPreviews: [],
      reminder: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    localStorage.setItem(
      "manifesto:notes",
      JSON.stringify([stored("01BAD", broken), stored("01GOOD", GIF)]),
    );
    const all = await new LocalStorageAdapter().getAll();
    expect(all.map((n) => n.id)).toEqual(["01BAD", "01GOOD"]);
    expect(all[0].images).toEqual([broken]);
    expect(isLocalImageRef(all[1].images[0])).toBe(true);
  });
});
