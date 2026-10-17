import {
  ATTACHMENT_REF_PREFIX,
  isAttachmentRef,
  type LinkPreview,
  MAX_IMAGE_ALT_LENGTH,
  MAX_IMAGES_PER_NOTE,
  MAX_LINK_PREVIEW_DESCRIPTION_LENGTH,
  MAX_LINK_PREVIEW_TITLE_LENGTH,
  MAX_LINK_PREVIEW_URL_LENGTH,
  MAX_LINK_PREVIEWS_PER_NOTE,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_NOTE,
} from "#/note.js";
import { type ImageKey, isImageKey } from "./imageSeal.js";

/**
 * A note's lists as a note may hold them, from whatever was opened. What is
 * opened was written by some client and checked by no server, so every
 * value is held to the limits the server once held it to, and one that
 * fails is left out.
 */

/** One image as a sealed note names it: the attachment, what opens it, and
 * what it shows in words, when someone has said. */
export interface ImageEntry extends ImageKey {
  id: string;
  alt?: string;
}

/**
 * What opens each image a note holds, by its `attachment:` reference. A note
 * in the app holds references alone; their keys are kept beside it, handed
 * to whatever seals the note and taken from whatever opens it.
 */
export type ImageKeys = ReadonlyMap<string, ImageKey>;

/** The reference an entry names, when the entry is whole; else null. */
function entryRef(item: unknown): [string, ImageKey] | null {
  if (!isImageKey(item)) return null;
  const { id, key, type } = item as ImageEntry;
  const ref = `${ATTACHMENT_REF_PREFIX}${typeof id === "string" ? id : ""}`;
  return isAttachmentRef(ref) ? [ref, { key, type }] : null;
}

function isHttpUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_LINK_PREVIEW_URL_LENGTH &&
    /^https?:\/\//i.test(value) &&
    URL.canParse(value)
  );
}

/**
 * Link previews as a note may hold them, from anything: each card checked
 * as the server checked one, a card that fails left out, and an image that
 * is not an attachment dropped from its card.
 *
 * The card shows `domain` as where the link goes, so it is always the URL's
 * own host, whatever was sealed: a writer could otherwise have a card name
 * one site and open another, on a shared note or a public link, and the
 * server cannot look inside to put it right.
 */
export function checkedLinkPreviews(
  raw: unknown,
  found?: Map<string, ImageKey>,
): LinkPreview[] {
  if (!Array.isArray(raw)) return [];
  // In a sealed note a thumbnail is an entry with its key; in the app, and
  // in what is about to be sealed, it is the reference alone.
  const imageOf = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return isAttachmentRef(value) ? value : undefined;
    }
    const entry = entryRef(value);
    if (!entry) return undefined;
    found?.set(...entry);
    return entry[0];
  };
  const out: LinkPreview[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LINK_PREVIEWS_PER_NOTE) break;
    if (typeof item !== "object" || item === null) continue;
    const preview = item as Record<string, unknown>;
    if (!isHttpUrl(preview.url)) continue;
    if (
      typeof preview.title !== "string" ||
      preview.title.length > MAX_LINK_PREVIEW_TITLE_LENGTH
    ) {
      continue;
    }
    const description =
      typeof preview.description === "string" &&
      preview.description.length <= MAX_LINK_PREVIEW_DESCRIPTION_LENGTH
        ? preview.description
        : undefined;
    const image = imageOf(preview.image);
    const favicon = imageOf(preview.favicon);
    out.push({
      url: preview.url,
      title: preview.title,
      ...(description !== undefined && { description }),
      ...(image !== undefined && { image }),
      ...(favicon !== undefined && { favicon }),
      domain: new URL(preview.url).host,
    });
  }
  return out;
}

/**
 * A note's images as references, from the sealed list's JSON. An entry
 * without a key and a type this app takes is left out, since it could not be
 * opened. Each one's key goes into `found`, and its description, "" for none
 * or one past `MAX_IMAGE_ALT_LENGTH`, into `alts` in step with the answer.
 */
export function checkedImages(
  raw: unknown,
  found: Map<string, ImageKey>,
  alts: string[] = [],
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_IMAGES_PER_NOTE) break;
    const entry = entryRef(item);
    if (!entry) continue;
    out.push(entry[0]);
    found.set(...entry);
    const { alt } = item as Partial<ImageEntry>;
    alts.push(
      typeof alt === "string" && alt.length <= MAX_IMAGE_ALT_LENGTH ? alt : "",
    );
  }
  return out;
}

/** Tags as a note may hold them, from anything. */
export function checkedTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const tag of raw) {
    if (out.length >= MAX_TAGS_PER_NOTE) break;
    if (typeof tag !== "string") continue;
    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) continue;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}
