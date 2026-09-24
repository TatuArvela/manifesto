import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoredImage } from "../components/StoredImage.js";
import { currentStorage } from "../storage/index.js";
import {
  attachmentObjectUrl,
  forgetAttachmentUrls,
  inlineImages,
} from "./attachments.js";
import { exportNotes } from "./exportNotes.js";
import { notes } from "./notesStore.js";

const REF = "attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV";
const GIF_BYTES = Uint8Array.from(atob("R0lGODlhAQABAAAAACw="), (c) =>
  c.charCodeAt(0),
);
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

let loadImage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  forgetAttachmentUrls();
  loadImage = vi.fn(async () => new Blob([GIF_BYTES], { type: "image/gif" }));
  vi.spyOn(currentStorage, "value", "get").mockReturnValue({
    loadImage,
    loadImages: async () => [],
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  notes.value = [];
});

describe("attachmentObjectUrl", () => {
  it("fetches an attachment once and shows it through a blob URL", async () => {
    const a = await attachmentObjectUrl(REF);
    const b = await attachmentObjectUrl(REF);
    expect(a).toMatch(/^blob:/);
    expect(b).toBe(a);
    expect(loadImage).toHaveBeenCalledOnce();
  });

  it("tries again after a failure", async () => {
    loadImage.mockRejectedValueOnce(new Error("offline"));
    expect(await attachmentObjectUrl(REF)).toBeNull();
    expect(await attachmentObjectUrl(REF)).toMatch(/^blob:/);
  });
});

describe("inlineImages", () => {
  it("puts the bytes back for anything leaving the session", async () => {
    expect(await inlineImages([GIF, REF])).toEqual([GIF, GIF]);
  });

  it("gives up rather than drop a picture", async () => {
    loadImage.mockRejectedValue(new Error("gone"));
    expect(await inlineImages([REF])).toBeNull();
  });
});

describe("exportNotes", () => {
  it("writes the bytes of stored attachments into the file", async () => {
    const note: Note = {
      id: "a",
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
      images: [REF],
      imageCount: 1,
      linkPreviews: [
        {
          url: "https://a.test/",
          title: "A",
          image: REF,
          favicon: "attachment:01ARZ3NDEKTSV4RRFFQ69G5FAW",
          domain: "a.test",
        },
      ],
      reminder: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    loadImage.mockImplementation(async (ref: string) => {
      if (ref !== REF) throw new Error("gone");
      return new Blob([GIF_BYTES], { type: "image/gif" });
    });
    notes.value = [note];
    const [exported] = (await exportNotes()) ?? [];
    expect(exported.images).toEqual([GIF]);
    // A preview image that cannot be read is left out; the card stays.
    expect(exported.linkPreviews).toEqual([
      { url: "https://a.test/", title: "A", image: GIF, domain: "a.test" },
    ]);
  });
});

describe("StoredImage", () => {
  it("shows an inline image at once and a stored one once fetched", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      <>
        <StoredImage src={GIF} alt="" />
        <StoredImage src={REF} alt="" />
      </>,
      host,
    );
    const imgs = () => [...host.querySelectorAll("img")].map((i) => i.src);
    expect(imgs()).toEqual([GIF]);
    await vi.waitFor(() => expect(imgs()).toHaveLength(2));
    expect(imgs()[1]).toMatch(/^blob:/);
    render(null, host);
    host.remove();
  });
});
