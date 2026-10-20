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
} from "#/note.ts";
import { type ImageKey, isImageKey } from "./imageSeal.ts";

/**
 * The lists of a note, as a note can contain them, from the opened data. A
 * client wrote the opened data, and no server checked it. Thus, the code checks
 * each value against the limits that the server used before, and removes a
 * value that fails.
 */

/**
 * One image as a sealed note names it: the attachment, what opens it, and its
 * description, when a person gave one.
 */
export interface ImageEntry extends ImageKey {
  id: string;
  alt?: string;
}

/**
 * What opens each image of a note, by its `attachment:` reference. In the app,
 * a note contains only references. Their keys are kept next to it. The code
 * that seals the note gets them, and the code that opens it gives them.
 */
export type ImageKeys = ReadonlyMap<string, ImageKey>;

/**
 * The reference that an entry names, when the entry is complete. Otherwise
 * null.
 */
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
 * Link previews as a note can contain them, from any input. The code checks
 * each card as the server did, removes a card that fails, and removes an image
 * that is not an attachment from its card.
 *
 * The card shows `domain` as the target of the link. Thus, it is always the
 * host of the URL, whatever was sealed. If not, a writer could make a card that
 * names one site and opens a different site, on a shared note or a public link.
 * The server cannot look inside to correct it.
 */
export function checkedLinkPreviews(
  raw: unknown,
  found?: Map<string, ImageKey>,
): LinkPreview[] {
  if (!Array.isArray(raw)) return [];
  // In a sealed note, a thumbnail is an entry with its key. In the app, and in
  // data that will be sealed, it is only the reference.
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
 * The images of a note as references, from the JSON of the sealed list. The
 * code removes an entry without a key and a type that this app accepts, because
 * it could not open it. The key of each image goes into `found`. Its
 * description goes into `alts`, aligned with the answer: "" for none, or for
 * one longer than `MAX_IMAGE_ALT_LENGTH`.
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

/** Tags as a note can contain them, from any input. */
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
