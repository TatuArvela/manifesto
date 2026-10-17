import {
  type ImageKey,
  type ImageKeySource,
  openImage,
  sealImage,
} from "@manifesto/shared";

/** An image that is not one of the kinds a note may hold, whatever the file
 * was called. */
export class ImageKindError extends Error {
  constructor() {
    super("Not a PNG, JPEG, GIF, WebP or AVIF image");
    this.name = "ImageKindError";
  }
}

/** An image as it goes to the server: what to send, and with which headers. */
export interface ImageUpload {
  body: Blob;
  headers: Record<string, string>;
  /** What opens it, to keep once the server has named it; null when it was
   * sent as it is. */
  key: ImageKey | null;
}

/**
 * What opens each image this device has met, by its reference: from every
 * note opened, and every image uploaded. A note in the app names its images
 * by reference alone, and this is where their keys wait to be sealed back
 * into it. The `Sealer` holds one for the unlocked account.
 */
export class ImageKeyRing {
  /** The keys by reference, as sealing a note reads them. */
  readonly byRef = new Map<string, ImageKey>();

  constructor(private readonly source: Promise<ImageKeySource>) {}

  /** An image sealed for upload. Rejects with `ImageKindError` for a file
   * that is not an image a note may hold. */
  async seal(image: Blob): Promise<ImageUpload> {
    const sealed = await sealImage(
      await this.source,
      new Uint8Array(await image.arrayBuffer()),
    );
    if (!sealed) throw new ImageKindError();
    return {
      body: new Blob([sealed.bytes], { type: "application/octet-stream" }),
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Attachment-Address": sealed.address,
      },
      key: sealed.key,
    };
  }

  /** Keeps what opens the image the server has just named `ref`. */
  keep(ref: string, key: ImageKey | null): void {
    if (key) this.byRef.set(ref, key);
  }

  /** Keeps every key a note that was just opened carries. */
  keepAll(keys: Iterable<[string, ImageKey]>): void {
    for (const [ref, key] of keys) this.byRef.set(ref, key);
  }

  /**
   * What opens the image `ref` names, or null when this device has none: for
   * what keeps a note on the device before it is sent, since a reference
   * alone opens nothing after a reload.
   */
  keyOf(ref: string): ImageKey | null {
    return this.byRef.get(ref) ?? null;
  }

  /** `to` is the same sealed image as `from`, stored again for a note's
   * owner: the same key opens it. */
  same(from: string, to: string): void {
    const key = this.byRef.get(from);
    if (key) this.byRef.set(to, key);
  }

  /** The image `ref` names, from its sealed bytes. Rejects when this device
   * has no key for it, or it does not open as the image its note says. */
  async open(ref: string, sealed: Blob): Promise<Blob> {
    const key = this.byRef.get(ref);
    const image = key
      ? await openImage(key, new Uint8Array(await sealed.arrayBuffer()))
      : null;
    if (!key || !image) throw new Error("The image could not be opened");
    return new Blob([image], { type: key.type });
  }
}
