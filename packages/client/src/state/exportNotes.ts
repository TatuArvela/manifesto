import type { Note } from "@manifesto/shared";
import { hasUnloadedImages } from "@manifesto/shared";
import { t } from "../i18n/index.js";
import { inlineImages, inlinePreviewImages } from "./attachments.js";
import { ensureImages, notes } from "./notesStore.js";
import { showError } from "./ui.js";

/**
 * How many attachment fetches an export has in flight at once. Firing one per
 * note together trips the server's per-user rate limit, and the failures that
 * come back are exactly the lossy backup this exists to prevent.
 */
const EXPORT_IMAGE_CONCURRENCY = 6;

/**
 * Every note as JSON, attachments included, or `null` if they could not all
 * be gathered. A server listing leaves the bytes behind, so the missing ones
 * are fetched first, and a partial backup is refused rather than handed back
 * as a file the user would trust.
 */
export async function exportNotes(): Promise<string | null> {
  const missing = notes.value.filter(hasUnloadedImages).map((n) => n.id);
  for (let i = 0; i < missing.length; i += EXPORT_IMAGE_CONCURRENCY) {
    await Promise.all(
      missing
        .slice(i, i + EXPORT_IMAGE_CONCURRENCY)
        .map((id) => ensureImages(id)),
    );
  }
  // `ensureImages` has already said what went wrong. Re-reading the signal
  // rather than trusting its return values also covers a note that arrived
  // mid-export.
  if (notes.value.some(hasUnloadedImages)) {
    showError(t("error.exportFailed"));
    return null;
  }
  // Who else holds a note, and the server's attachment references, mean
  // nothing in a file imported somewhere else: the file carries the bytes.
  const plain: Note[] = [];
  for (const { sharing: _sharing, ...note } of notes.value) {
    const images = await inlineImages(note.images);
    if (images === null) {
      showError(t("error.exportFailed"));
      return null;
    }
    plain.push({
      ...note,
      images,
      linkPreviews: await inlinePreviewImages(note.linkPreviews),
    });
  }
  return JSON.stringify(plain, null, 2);
}
