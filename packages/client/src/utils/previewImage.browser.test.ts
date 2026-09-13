import {
  IMAGE_DATA_URL_PATTERN,
  MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { shrinkPreviewImage } from "./previewImage.js";

/** A noisy image, which compresses badly, so size limits are actually tested. */
function noisyPng(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const data = ctx.createImageData(width, height);
  for (let i = 0; i < data.data.length; i++) {
    data.data[i] = ((i * 7919) % 256) ^ (((i >> 3) * 31) % 256);
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

async function dimensions(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

describe("shrinkPreviewImage", () => {
  it("scales a large thumbnail down and under the stored cap", async () => {
    const source = noisyPng(2400, 1260);
    expect(source.length).toBeGreaterThan(
      MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES,
    );

    const shrunk = await shrinkPreviewImage(source, "thumbnail");

    expect(shrunk).not.toBeNull();
    expect(shrunk?.length).toBeLessThanOrEqual(
      MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES,
    );
    expect(shrunk).toMatch(IMAGE_DATA_URL_PATTERN);
    const { width, height } = await dimensions(shrunk as string);
    expect(Math.max(width, height)).toBeLessThanOrEqual(640);
    // Aspect ratio survives.
    expect(width / height).toBeCloseTo(2400 / 1260, 1);
  });

  it("makes a favicon a small PNG", async () => {
    const shrunk = await shrinkPreviewImage(noisyPng(256, 256), "favicon");
    expect(shrunk?.startsWith("data:image/png;base64,")).toBe(true);
    const { width } = await dimensions(shrunk as string);
    expect(width).toBe(64);
  });

  it("does not enlarge an image that is already small", async () => {
    const shrunk = await shrinkPreviewImage(noisyPng(16, 16), "favicon");
    expect((await dimensions(shrunk as string)).width).toBe(16);
  });

  it("resolves to null for something that is not an image", async () => {
    expect(
      await shrinkPreviewImage(
        "data:image/png;base64,PGh0bWw+PC9odG1sPg==",
        "thumbnail",
      ),
    ).toBeNull();
  });
});
