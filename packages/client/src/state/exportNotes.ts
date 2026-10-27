import type { Note, NoteVersion } from "@manifesto/shared";
import { exportArchiveFiles, hasUnloadedImages } from "@manifesto/shared";
import { APP_FILE_SLUG } from "#/config.ts";
import { t } from "#/i18n/index.ts";
import { storage } from "#/storage/index.ts";
import { sealer } from "#/storage/sealing.ts";
import { writeZip } from "#/utils/zip.ts";
import { saveFile } from "./account/accountExport.ts";
import { inlineImages, inlinePreviewImages } from "./attachments.ts";
import { ensureImages, notes } from "./notesStore.ts";
import { prefsSnapshot } from "./prefs.ts";
import { showError } from "./ui.ts";

/**
 * How many attachment fetches an export has in progress at the same time. When
 * one fetch for each note started together, it went over the rate limit of the
 * server for each user. The failures that come back are exactly the incomplete
 * backup that this code prevents.
 */
const EXPORT_IMAGE_CONCURRENCY = 6;

/**
 * Each note as it goes into a backup, with its attachments, or `null` if the
 * code could not collect all of them. A server listing does not include the
 * bytes. Thus, the code loads the missing bytes first. It refuses a partial
 * backup, and does not give back a file that the user would trust.
 */
export async function exportNotes(): Promise<Note[] | null> {
  // A note that this account owns and that did not open on this device is not
  // in `notes`. A backup without it is the partial backup that the code below
  // refuses.
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
  // `ensureImages` already told what went wrong. A new read of the signal, in
  // place of trust in its return values, also covers a note that arrived during
  // the export.
  if (notes.value.some(hasUnloadedImages)) {
    showError(t("error.exportFailed"));
    return null;
  }
  // The other holders of a note, and the attachment references of the server,
  // mean nothing in a file imported in a different place. The file carries the
  // bytes. The owner of a note shared with this account must make its backup.
  // If imported, the import would only refuse it as the note of a different
  // person.
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
 * The export archive, built here in both modes: `notes.json`, a Markdown copy
 * of each note, `versions.json` and the `preferences.json` of this browser (see
 * `exportArchiveFiles`). When connected, the server has only sealed notes, and
 * nothing readable from which to build one. Null if the code could not collect
 * all notes, which it already told.
 */
export async function exportArchive(): Promise<Blob | null> {
  const backup = await exportNotes();
  if (backup === null) return null;
  const versions: NoteVersion[] = [];
  for (const note of backup) {
    try {
      // The text of each version only. Its images are references to this
      // session, which the archive would have to inline. The import files a
      // version without them, and the notes carry their own images.
      for (const {
        images: _i,
        imageAlts: _a,
        ...words
      } of await storage.listVersions(note.id)) {
        versions.push(words);
      }
    } catch (err) {
      // A history is a safety net under the notes. A backup without the history
      // of one note still restores each note.
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
 * Downloads each note that this account owns as the export zip, built in this
 * browser from the notes that it opened. Resolves with if a file was given, and
 * never rejects.
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
