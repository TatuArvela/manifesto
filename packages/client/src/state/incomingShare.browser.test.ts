import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
});
