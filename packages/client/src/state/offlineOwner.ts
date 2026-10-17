import {
  type ImageKey,
  isImageKey,
  type LinkPreview,
  NoteColor,
  NoteFont,
  previewImages,
} from "@manifesto/shared";
import { storageConnection } from "#/storage/index.ts";
import { type OfflineOwner, openModeOwner } from "#/storage/offlineNotes.ts";
import { sealer, storageKeys } from "#/storage/sealing.ts";

/**
 * Whose records `storage/offlineNotes.ts` keeps for at the moment: the
 * unlocked account in connected mode, the browser in open mode. Null while
 * signed out or locked, when nothing can be sealed and nothing is kept.
 */
export function offlineOwner(): OfflineOwner | null {
  const { serverUrl, token } = storageConnection.peek();
  // `=== null`, not falsiness: "" is a same-origin server.
  if (serverUrl === null) return openModeOwner();
  const keys = storageKeys.peek();
  if (token === null || keys === null) return null;
  return { id: keys.userId, keys };
}

/**
 * What opens each image a kept note names, by reference. A note in the app
 * names its images by reference alone and the `Sealer` holds their keys in
 * memory, so a note kept across a reload has to carry them itself, or it
 * could not be sealed when it is sent. Empty in open mode.
 */
export function imageKeysOf(
  images: readonly string[],
  linkPreviews: readonly LinkPreview[],
): Record<string, ImageKey> {
  const sealing = sealer.peek();
  const out: Record<string, ImageKey> = {};
  if (!sealing) return out;
  for (const ref of [...images, ...previewImages(linkPreviews)]) {
    const key = sealing.imageKeyOf(ref);
    if (key) out[ref] = key;
  }
  return out;
}

/** Hands kept image keys back to the `Sealer`. */
export function restoreImageKeys(keys: unknown): void {
  const sealing = sealer.peek();
  if (!sealing || typeof keys !== "object" || keys === null) return;
  for (const [ref, key] of Object.entries(keys)) {
    if (isImageKey(key)) sealing.keepImageKey(ref, key);
  }
}

const COLORS = new Set<string>(Object.values(NoteColor));
const FONTS = new Set<string>(Object.values(NoteFont));

/** The fields a kept note carries, as they were written, from anything. */
export interface KeptFields {
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  pinned: boolean;
  tags: string[];
  images: string[];
  imageAlts: string[];
  linkPreviews: LinkPreview[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * A kept note's fields. The records are this app's own, sealed or in open
 * mode beside the notes themselves, so this only makes sure each field has
 * its type; what is sent is checked again as it is sealed.
 */
export function keptFields(raw: Record<string, unknown>): KeptFields {
  const color = raw.color;
  const font = raw.font;
  return {
    title: typeof raw.title === "string" ? raw.title : "",
    content: typeof raw.content === "string" ? raw.content : "",
    color:
      typeof color === "string" && COLORS.has(color)
        ? (color as NoteColor)
        : NoteColor.Default,
    font:
      typeof font === "string" && FONTS.has(font)
        ? (font as NoteFont)
        : NoteFont.Default,
    pinned: raw.pinned === true,
    tags: strings(raw.tags),
    images: strings(raw.images),
    imageAlts: strings(raw.imageAlts),
    linkPreviews: Array.isArray(raw.linkPreviews)
      ? raw.linkPreviews.filter(
          (p): p is LinkPreview =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as LinkPreview).url === "string" &&
            typeof (p as LinkPreview).title === "string" &&
            typeof (p as LinkPreview).domain === "string",
        )
      : [],
  };
}
