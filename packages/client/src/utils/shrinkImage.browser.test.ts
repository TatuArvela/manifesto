import { describe, expect, it } from "vitest";
import { MAX_IMAGE_EDGE, shrinkImage } from "./shrinkImage.js";

/** A noisy image, so the encoders cannot squeeze it to nothing. */
function picture(width: number, height: number, type: string, quality = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const data = ctx.createImageData(width, height);
  for (let i = 0; i < data.data.length; i++) {
    data.data[i] = (i * 2654435761) % 256;
  }
  ctx.putImageData(data, 0, 0);
  return new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b as Blob), type, quality),
  );
}

async function size(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}

describe("shrinkImage", () => {
  it("brings a large photo down to the edge, smaller than it was", async () => {
    const photo = await picture(4000, 3000, "image/jpeg");
    const shrunk = await shrinkImage(photo);
    expect(await size(shrunk)).toEqual({ width: MAX_IMAGE_EDGE, height: 1920 });
    expect(shrunk.size).toBeLessThan(photo.size);
    expect(["image/webp", "image/jpeg"]).toContain(shrunk.type);
  });

  it("keeps a small image exactly as it came", async () => {
    const small = await picture(200, 100, "image/png");
    expect(await shrinkImage(small)).toBe(small);
  });

  it("keeps a large screenshot a PNG", async () => {
    const screenshot = await picture(3000, 2000, "image/png");
    const shrunk = await shrinkImage(screenshot);
    expect(shrunk.type).toBe("image/png");
    expect((await size(shrunk)).width).toBeLessThanOrEqual(MAX_IMAGE_EDGE);
  });

  it("leaves a GIF and anything undecodable alone", async () => {
    const gif = new Blob([new Uint8Array(10)], { type: "image/gif" });
    expect(await shrinkImage(gif)).toBe(gif);
    const broken = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
    expect(await shrinkImage(broken)).toBe(broken);
  });
});
