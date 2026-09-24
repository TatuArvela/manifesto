import type { Note, NoteVersion } from "@manifesto/shared";
import { exportArchiveFiles, hasUnloadedImages } from "@manifesto/shared";
import { APP_FILE_SLUG } from "../config.js";
import { t } from "../i18n/index.js";
import { storage, storageConnection } from "../storage/index.js";
import { writeZip } from "../utils/zip.js";
import { downloadAccountExport, saveFile } from "./accountExport.js";
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
 * Every note as it goes into a backup, attachments included, or `null` if
 * they could not all be gathered. A server listing leaves the bytes behind, so the missing ones
 * are fetched first, and a partial backup is refused rather than handed back
 * as a file the user would trust.
 */
export async function exportNotes(): Promise<Note[] | null> {
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
  return plain;
}

/**
 * The export archive, built here: `notes.json`, a Markdown copy of each note
 * and `versions.json`, laid out as a server lays out its own (see
 * `exportArchiveFiles`), so either imports anywhere. Null if the notes could
 * not all be gathered, which has already been said.
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
    exportArchiveFiles(backup, versions).map(({ name, text }) => ({
      name,
      data: encoder.encode(text),
    })),
  );
}

/**
 * Downloads every note as the export zip. Connected, the server builds it for
 * the account; in open mode this browser builds the same archive from what it
 * holds. Resolves whether a file was handed over, and never rejects.
 */
export async function downloadExport(): Promise<boolean> {
  const { serverUrl, token } = storageConnection.value;
  if (serverUrl !== null && token) return downloadAccountExport();
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
