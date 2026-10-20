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
 * For whom `storage/offlineNotes.ts` keeps records at the moment: the unlocked
 * account in connected mode, the browser in open mode. Null while signed out or
 * locked, when nothing can be sealed and nothing is kept.
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
 * What opens each image that a kept note names, by reference. A note in the app
 * names its images only by reference, and the `Sealer` keeps their keys in
 * memory. Thus, a note kept across a reload must carry them itself. If not, the
 * code could not seal it when it is sent. Empty in open mode.
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

/** Gives kept image keys back to the `Sealer`. */
export function restoreImageKeys(keys: unknown): void {
  const sealing = sealer.peek();
  if (!sealing || typeof keys !== "object" || keys === null) return;
  for (const [ref, key] of Object.entries(keys)) {
    if (isImageKey(key)) sealing.keepImageKey(ref, key);
  }
}

const COLORS = new Set<string>(Object.values(NoteColor));
const FONTS = new Set<string>(Object.values(NoteFont));

/**
 * The fields that a kept note carries, as they were written, from any source.
 */
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
 * The fields of a kept note. The records belong to this app, sealed or (in open
 * mode) next to the notes themselves. Thus, this only makes sure that each
 * field has its type. The code checks what is sent again when it seals it.
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
