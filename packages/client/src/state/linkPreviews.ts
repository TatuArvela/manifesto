import {
  type LinkPreview,
  MAX_LINK_PREVIEWS_PER_NOTE,
} from "@manifesto/shared";
import { t } from "../i18n/index.js";
import { createStorage } from "../storage/index.js";
import { appendStubPreviews, normalizeDomain } from "../utils/linkPreview.js";
import { shrinkPreviewImage } from "../utils/previewImage.js";
import { notes, updateNote } from "./actions.js";
import { showError } from "./ui.js";

/**
 * Link previews arrive in two steps. A plain card (the URL and its domain) is
 * added the moment a link is pasted, in either mode. In connected mode the
 * server is then asked for the page's title, description, image and favicon,
 * and the card is filled in when that answer comes back. Open mode stops at
 * the plain card; see `LocalStorageAdapter.fetchLinkPreview`.
 */

const storage = createStorage();

const inflight = new Map<string, Promise<LinkPreview | null>>();

/**
 * The filled-in preview for a URL, or null when there is nothing to add to the
 * plain card. Never rejects: a page that cannot be previewed is an ordinary
 * outcome, and the plain card already on the note is the right result, so it
 * is not reported to the user.
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
    console.warn(`Link preview for ${url} failed:`, err);
    return null;
  }
  if (!fetched) return null;
  const [image, favicon] = await Promise.all([
    fetched.image ? shrinkPreviewImage(fetched.image, "thumbnail") : null,
    fetched.favicon ? shrinkPreviewImage(fetched.favicon, "favicon") : null,
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
 * Puts resolved previews into a saved note, replacing the cards for the same
 * URLs. A card the user removed while its preview was loading stays removed.
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
  // Read after the wait, not before: the note may have changed meanwhile.
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

/** Tells the user a note is full, when a paste tried to go past the cap. */
export function reportPreviewOverflow(overflow: boolean) {
  if (overflow) {
    showError(t("linkPreview.tooMany", { max: MAX_LINK_PREVIEWS_PER_NOTE }));
  }
}

/**
 * Adds cards for the URLs to a saved note in one write, then fills them in.
 * Resolves false if either write failed; `updateNote` has already said so.
 */
export async function addLinkPreviews(
  noteId: string,
  urls: string[],
): Promise<boolean> {
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
