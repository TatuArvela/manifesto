import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookmarkletHref,
  SHARE_CACHE,
  SHARE_IMAGE_KEY_PREFIX,
  SHARE_TARGET_PARAM,
  SHARE_TEXT_KEY,
} from "../shareTarget.js";
import { incomingShare, takeIncomingShare } from "./incomingShare.js";
import { activeView } from "./ui.js";

const scope = () => new URL(import.meta.env.BASE_URL, window.location.origin);
// A 1x1 transparent PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

async function park(text: object, images: Uint8Array[] = []) {
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(new URL(SHARE_TEXT_KEY, scope()).href, Response.json(text));
  for (const [i, bytes] of images.entries()) {
    await cache.put(
      new URL(`${SHARE_IMAGE_KEY_PREFIX}${i}`, scope()).href,
      new Response(bytes as BlobPart, {
        headers: { "Content-Type": "image/png" },
      }),
    );
  }
}

describe("takeIncomingShare", () => {
  const start = window.location.href;
  beforeEach(async () => {
    incomingShare.value = null;
    await caches.delete(SHARE_CACHE);
  });
  afterEach(() => history.replaceState(null, "", start));

  it("does nothing without the parameter", async () => {
    await park({ title: "T", text: "x", url: "" });
    await takeIncomingShare();
    expect(incomingShare.value).toBeNull();
    expect(await caches.has(SHARE_CACHE)).toBe(true);
  });

  it("turns a parked share into a draft and clears it", async () => {
    activeView.value = "archived";
    await park({ title: "Page", text: "", url: "https://example.com/" }, [PNG]);
    history.replaceState(null, "", `?${SHARE_TARGET_PARAM}`);
    await takeIncomingShare();
    expect(incomingShare.value?.title).toBe("Page");
    expect(incomingShare.value?.content).toBe("https://example.com/");
    expect(incomingShare.value?.images).toHaveLength(1);
    expect(incomingShare.value?.images[0]).toMatch(/^data:image\/png;base64,/);
    expect(activeView.value).toBe("active");
    expect(window.location.search).toBe("");
    expect(await caches.has(SHARE_CACHE)).toBe(false);
  });

  it("opens nothing for an empty share", async () => {
    await park({ title: "", text: "", url: "" });
    history.replaceState(null, "", `?${SHARE_TARGET_PARAM}`);
    await takeIncomingShare();
    expect(incomingShare.value).toBeNull();
  });

  it("takes a bookmarklet's page from the query, and leaves no trace of it", async () => {
    await park({ title: "Parked", text: "", url: "" });
    const query = new URLSearchParams({
      title: "An article",
      url: "https://example.com/a",
      text: "the part worth keeping",
    });
    history.replaceState(null, "", `?${SHARE_TARGET_PARAM}&${query}`);
    await takeIncomingShare();
    expect(incomingShare.value).toEqual({
      title: "An article",
      content: "the part worth keeping\n\nhttps://example.com/a",
      images: [],
    });
    expect(window.location.search).toBe("");
  });
});

describe("the bookmarklet", () => {
  it("opens the app with the page's title, address and selection", () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const range = document.createRange();
    const selected = document.createElement("p");
    selected.textContent = "chosen words";
    document.body.appendChild(selected);
    range.selectNodeContents(selected);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    try {
      const href = bookmarkletHref("https://notes.example.com/");
      expect(href.startsWith("javascript:")).toBe(true);
      new Function(href.slice("javascript:".length))();

      const [url, target] = opened.mock.calls[0] ?? [];
      const sent = new URL(String(url));
      expect(sent.origin + sent.pathname).toBe("https://notes.example.com/");
      expect(sent.searchParams.has(SHARE_TARGET_PARAM)).toBe(true);
      expect(sent.searchParams.get("title")).toBe(document.title);
      expect(sent.searchParams.get("url")).toBe(window.location.href);
      expect(sent.searchParams.get("text")).toBe("chosen words");
      expect(target).toBe("_blank");
    } finally {
      getSelection()?.removeAllRanges();
      selected.remove();
      opened.mockRestore();
    }
  });

  it("keeps an address with a percent escape in it one string", () => {
    // A browser percent-decodes a `javascript:` URL before running it, so an
    // escaped quote in the address must not come out as a real one.
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      const href = bookmarkletHref("https://notes.example.com/a%22b/");
      new Function(decodeURIComponent(href.slice("javascript:".length)))();

      const sent = new URL(String(opened.mock.calls[0]?.[0]));
      expect(sent.origin + sent.pathname).toBe(
        "https://notes.example.com/a%22b/",
      );
    } finally {
      opened.mockRestore();
    }
  });
});
