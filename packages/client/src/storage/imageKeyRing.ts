import {
  type ImageKey,
  type ImageKeySource,
  openImage,
  sealImage,
} from "@manifesto/shared";

/**
 * An image that is not one of the kinds that a note can contain, whatever the
 * name of the file was.
 */
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
  /**
   * What opens it, to keep after the server named it. Null when it was sent as
   * it is.
   */
  key: ImageKey | null;
}

/**
 * What opens each image that this device saw, by its reference: from each note
 * opened, and each image uploaded. A note in the app names its images only by
 * reference, and their keys wait here to be sealed back into it. The `Sealer`
 * has one for the unlocked account.
 */
export class ImageKeyRing {
  /** The keys by reference, as the seal of a note reads them. */
  readonly byRef = new Map<string, ImageKey>();

  constructor(private readonly source: Promise<ImageKeySource>) {}

  /**
   * An image sealed for upload. Rejects with `ImageKindError` for a file that
   * is not an image that a note can contain.
   */
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

  /** Keeps what opens the image that the server just named `ref`. */
  keep(ref: string, key: ImageKey | null): void {
    if (key) this.byRef.set(ref, key);
  }

  /** Keeps each key that a note that just opened carries. */
  keepAll(keys: Iterable<[string, ImageKey]>): void {
    for (const [ref, key] of keys) this.byRef.set(ref, key);
  }

  /**
   * What opens the image that `ref` names, or null when this device has none.
   * For the code that keeps a note on the device before it is sent, because a
   * reference alone opens nothing after a reload.
   */
  keyOf(ref: string): ImageKey | null {
    return this.byRef.get(ref) ?? null;
  }

  /**
   * `to` is the same sealed image as `from`, stored again for the owner of a
   * note. The same key opens it.
   */
  same(from: string, to: string): void {
    const key = this.byRef.get(from);
    if (key) this.byRef.set(to, key);
  }

  /**
   * The image that `ref` names, from its sealed bytes. Rejects when this device
   * has no key for it, or when it does not open as the image that its note
   * says.
   */
  async open(ref: string, sealed: Blob): Promise<Blob> {
    const key = this.byRef.get(ref);
    const image = key
      ? await openImage(key, new Uint8Array(await sealed.arrayBuffer()))
      : null;
    if (!key || !image) throw new Error("The image could not be opened");
    return new Blob([image], { type: key.type });
  }
}
