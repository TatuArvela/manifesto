import {
  type LinkPreview,
  MAX_LINK_PREVIEWS_PER_NOTE,
} from "@manifesto/shared";
import { t } from "#/i18n/index.ts";
import { storage } from "#/storage/index.ts";
import { dataUrlToBlob } from "#/utils/dataUrl.ts";
import { appendStubPreviews, normalizeDomain } from "#/utils/linkPreview.ts";
import {
  type PreviewImageKind,
  shrinkPreviewImage,
} from "#/utils/previewImage.ts";
import { notes, updateNote } from "./notesStore.ts";
import { linkPreviewCards } from "./prefs.ts";
import { showError } from "./ui.ts";

/**
 * Link previews arrive in two steps. A plain card (the URL and its domain) is
 * added at the moment when a link is pasted, in both modes. In connected mode,
 * the client then asks the server for the title, description, image and favicon
 * of the page. The card is filled when that answer comes back. Open mode stops
 * at the plain card. See `LocalStorageAdapter.fetchLinkPreview`.
 */

const inflight = new Map<string, Promise<LinkPreview | null>>();

/**
 * The filled preview for a URL, or null when there is nothing to add to the
 * plain card. Never rejects. A page that cannot have a preview is a usual
 * result, and the plain card already on the note is the correct result. Thus,
 * the user does not get a report.
 */
export function resolveLinkPreview(url: string): Promise<LinkPreview | null> {
  let pending = inflight.get(url);
  if (!pending) {
    pending = loadLinkPreview(url).finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  return pending;
}

async function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  let fetched: LinkPreview | null;
  try {
    fetched = await storage.fetchLinkPreview(url);
  } catch (err) {
    console.warn("Link preview for %s failed:", url, err);
    return null;
  }
  if (!fetched) return null;
  const [image, favicon] = await Promise.all([
    fetched.image ? storePreviewImage(fetched.image, "thumbnail") : null,
    fetched.favicon ? storePreviewImage(fetched.favicon, "favicon") : null,
  ]);
  return {
    url,
    title: fetched.title || url,
    ...(fetched.description && { description: fetched.description }),
    ...(image && { image }),
    ...(favicon && { favicon }),
    domain: fetched.domain || normalizeDomain(url),
  };
}

/**
 * A loaded preview image, shrunk and stored as each attachment is, as the
 * reference that a preview has. Null to continue without it. Previews are
 * stored, not kept inline. Thus, they add only their text to a note, which goes
 * in each listing and each write.
 */
async function storePreviewImage(
  source: string,
  kind: PreviewImageKind,
): Promise<string | null> {
  const shrunk = await shrinkPreviewImage(source, kind);
  if (!shrunk) return null;
  try {
    return await storage.putImage(dataUrlToBlob(shrunk));
  } catch (err) {
    console.warn("Storing a link preview image failed:", err);
    return null;
  }
}

function samePreview(a: LinkPreview, b: LinkPreview): boolean {
  return (
    a.url === b.url &&
    a.title === b.title &&
    a.description === b.description &&
    a.image === b.image &&
    a.favicon === b.favicon &&
    a.domain === b.domain
  );
}

/**
 * Puts resolved previews into a saved note, and replaces the cards for the same
 * URLs. A card that the user removed while its preview loaded stays removed.
 */
export async function applyLinkPreviews(
  noteId: string,
  pending: Promise<LinkPreview | null>[],
): Promise<boolean> {
  const resolved = (await Promise.all(pending)).filter(
    (p): p is LinkPreview => p !== null,
  );
  if (resolved.length === 0) return true;
  const byUrl = new Map(resolved.map((p) => [p.url, p]));
  // Read after the wait, not before. The note can have changed in the meantime.
  const current = notes.value.find((n) => n.id === noteId);
  if (!current) return false;
  let changed = false;
  const linkPreviews = current.linkPreviews.map((preview) => {
    const next = byUrl.get(preview.url);
    if (!next || samePreview(preview, next)) return preview;
    changed = true;
    return next;
  });
  if (!changed) return true;
  return await updateNote(noteId, { linkPreviews });
}

/**
 * Tells the user that a note is full, when a paste tried to go past the limit.
 */
export function reportPreviewOverflow(overflow: boolean) {
  if (overflow) {
    showError(t("linkPreview.tooMany", { max: MAX_LINK_PREVIEWS_PER_NOTE }));
  }
}

/**
 * Adds cards for the URLs to a saved note in one write, then fills them, unless
 * the user turned the cards off (`linkPreviewCards`). Resolves false if one of
 * the writes failed. `updateNote` already told the user.
 */
export async function addLinkPreviews(
  noteId: string,
  urls: string[],
): Promise<boolean> {
  if (!linkPreviewCards.value) return true;
  const current = notes.value.find((n) => n.id === noteId);
  if (!current) return false;
  const { previews, added, overflow } = appendStubPreviews(
    current.linkPreviews,
    urls,
  );
  reportPreviewOverflow(overflow);
  if (added.length === 0) return true;
  if (!(await updateNote(noteId, { linkPreviews: previews }))) return false;
  return await applyLinkPreviews(noteId, added.map(resolveLinkPreview));
}
