import {
  isStoredImageRef,
  type LinkPreview,
  MAX_LINK_PREVIEWS_PER_NOTE,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { LocalStorageAdapter } from "../storage/index.js";
import { makeStubPreview } from "../utils/linkPreview.js";
import { notes, updateNote } from "./actions.js";
import {
  addLinkPreviews,
  applyLinkPreviews,
  resolveLinkPreview,
} from "./linkPreviews.js";
import { createNoteOrFail } from "./testSupport.js";
import { toasts } from "./ui.js";

function tinyPng(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  return canvas.toDataURL("image/png");
}

/** What a connected-mode server answers, seen through the adapter. Open mode
 * is the same adapter with this left alone. */
function serverAnswers(
  answer: (url: string) => LinkPreview | null | Promise<LinkPreview | null>,
) {
  return vi
    .spyOn(LocalStorageAdapter.prototype, "fetchLinkPreview")
    .mockImplementation(async (url) => answer(url));
}

beforeEach(() => {
  localStorage.clear();
  notes.value = [];
  toasts.value = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  notes.value = [];
});

const urlsOf = (id: string) =>
  notes.value.find((n) => n.id === id)?.linkPreviews.map((p) => p.url);

describe("addLinkPreviews", () => {
  it("keeps every URL of a paste, not just the last", async () => {
    const note = await createNoteOrFail({ title: "Links" });

    await addLinkPreviews(note.id, [
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);

    expect(urlsOf(note.id)).toEqual([
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);
    const stored = JSON.parse(localStorage.getItem("manifesto:notes") ?? "[]");
    expect(stored[0].linkPreviews).toHaveLength(3);
  });

  it("leaves plain cards in open mode", async () => {
    const note = await createNoteOrFail({});
    await addLinkPreviews(note.id, ["https://www.a.test/x"]);
    expect(notes.value[0].linkPreviews).toEqual([
      makeStubPreview("https://www.a.test/x"),
    ]);
  });

  it("fills the cards in from the server, with the images shrunk and stored", async () => {
    const png = tinyPng();
    serverAnswers((url) => ({
      url,
      title: `Title of ${url}`,
      description: "About it",
      image: png,
      favicon: png,
      domain: "a.test",
    }));
    const note = await createNoteOrFail({});

    expect(await addLinkPreviews(note.id, ["https://a.test/1"])).toBe(true);

    const [preview] = notes.value[0].linkPreviews;
    expect(preview.title).toBe("Title of https://a.test/1");
    expect(preview.description).toBe("About it");
    // Stored like an attachment, so a note carries only a reference.
    expect(isStoredImageRef(preview.image ?? "")).toBe(true);
    expect(isStoredImageRef(preview.favicon ?? "")).toBe(true);
    const adapter = new LocalStorageAdapter();
    expect((await adapter.loadImage(preview.image ?? "")).type).toMatch(
      /^image\/(webp|jpeg|png)$/,
    );
    expect((await adapter.loadImage(preview.favicon ?? "")).type).toBe(
      "image/png",
    );
  });

  it("keeps the plain card when the server has nothing, or fails", async () => {
    serverAnswers((url) => {
      if (url.includes("broken")) throw new Error("429");
      return null;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const note = await createNoteOrFail({});

    await addLinkPreviews(note.id, [
      "https://none.test",
      "https://broken.test",
    ]);

    expect(notes.value[0].linkPreviews).toEqual([
      makeStubPreview("https://none.test"),
      makeStubPreview("https://broken.test"),
    ]);
    // A preview that could not be had is not an error the user needs to see.
    expect(toasts.value).toEqual([]);
  });

  it("stops at the per-note cap and tells the user", async () => {
    const note = await createNoteOrFail({});
    const urls = Array.from(
      { length: MAX_LINK_PREVIEWS_PER_NOTE + 3 },
      (_, i) => `https://${i}.test`,
    );

    await addLinkPreviews(note.id, urls);

    expect(notes.value[0].linkPreviews).toHaveLength(
      MAX_LINK_PREVIEWS_PER_NOTE,
    );
    expect(toasts.value.map((toast) => toast.message)).toEqual([
      t("linkPreview.tooMany", { max: MAX_LINK_PREVIEWS_PER_NOTE }),
    ]);
  });
});

describe("applyLinkPreviews", () => {
  it("does not bring back a card removed while its preview was loading", async () => {
    let answer: (preview: LinkPreview) => void = () => {};
    serverAnswers(
      () => new Promise<LinkPreview>((resolve) => (answer = resolve)),
    );
    const note = await createNoteOrFail({
      linkPreviews: [makeStubPreview("https://a.test")],
    });

    const pending = resolveLinkPreview("https://a.test");
    const applied = applyLinkPreviews(note.id, [pending]);
    await updateNote(note.id, { linkPreviews: [] });
    answer({ url: "https://a.test", title: "Late", domain: "a.test" });

    expect(await applied).toBe(true);
    expect(notes.value[0].linkPreviews).toEqual([]);
  });

  it("writes nothing when the preview is already in place", async () => {
    const preview = { url: "https://a.test", title: "A", domain: "a.test" };
    const note = await createNoteOrFail({ linkPreviews: [preview] });
    const update = vi.spyOn(LocalStorageAdapter.prototype, "update");

    expect(
      await applyLinkPreviews(note.id, [Promise.resolve({ ...preview })]),
    ).toBe(true);

    expect(update).not.toHaveBeenCalled();
  });
});
