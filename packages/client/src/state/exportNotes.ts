import type { Note, NoteVersion } from "@manifesto/shared";
import { exportArchiveFiles, hasUnloadedImages } from "@manifesto/shared";
import { APP_FILE_SLUG } from "../config.js";
import { t } from "../i18n/index.js";
import { storage } from "../storage/index.js";
import { sealer } from "../storage/sealing.js";
import { writeZip } from "../utils/zip.js";
import { saveFile } from "./account/accountExport.js";
import { inlineImages, inlinePreviewImages } from "./attachments.js";
import { ensureImages, notes } from "./notesStore.js";
import { prefsSnapshot } from "./prefs.js";
import { showError } from "./ui.js";

/**
 * How many attachment fetches an export has in flight at once. Firing one per
 * note together trips the server's per-user rate limit, and the failures that
 * come back are exactly the lossy backup this exists to prevent.
 */
const EXPORT_IMAGE_CONCURRENCY = 6;

/**
 * Every note as it goes into a backup, attachments included, or `null` if
 * they could not all be gathered. A server listing leaves the bytes behind, so the missing ones
 * are fetched first, and a partial backup is refused rather than handed back
 * as a file the user would trust.
 */
export async function exportNotes(): Promise<Note[] | null> {
  // A note this account owns that did not open on this device is not in
  // `notes`, and a backup without it is the partial one refused below.
  if (sealer.peek()?.missesOwnNotes()) {
    showError(t("error.exportUnopened"));
    return null;
  }
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
  // A note shared with this account is its owner's to back up, and imported
  // it would only be refused as someone else's.
  const plain: Note[] = [];
  for (const { sharing, ...note } of notes.value) {
    if ((sharing?.role ?? "owner") !== "owner") continue;
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
  return plain;
}

/**
 * The export archive, built here in both modes: `notes.json`, a Markdown
 * copy of each note, `versions.json` and this browser's `preferences.json`
 * (see `exportArchiveFiles`). Connected, the server holds only sealed notes
 * and has nothing readable to build one from. Null if the notes could not
 * all be gathered, which has already been said.
 */
export async function exportArchive(): Promise<Blob | null> {
  const backup = await exportNotes();
  if (backup === null) return null;
  const versions: NoteVersion[] = [];
  for (const note of backup) {
    try {
      versions.push(...(await storage.listVersions(note.id)));
    } catch (err) {
      // A history is a safety net under the notes; a backup without one
      // note's history still restores every note.
      console.warn("Failed to read versions for export:", err);
    }
  }
  const encoder = new TextEncoder();
  return writeZip(
    exportArchiveFiles(backup, versions, prefsSnapshot()).map(
      ({ name, text }) => ({
        name,
        data: encoder.encode(text),
      }),
    ),
  );
}

/**
 * Downloads every note this account owns as the export zip, built in this
 * browser from the notes it has opened. Resolves whether a file was handed
 * over, and never rejects.
 */
export async function downloadExport(): Promise<boolean> {
  try {
    const zip = await exportArchive();
    if (zip === null) return false;
    const date = new Date().toISOString().slice(0, 10);
    saveFile(zip, `${APP_FILE_SLUG}-export-${date}.zip`);
    return true;
  } catch (err) {
    console.warn("Failed to build the export:", err);
    return false;
  }
}
