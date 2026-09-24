import type { NoteVersion } from "@manifesto/shared";
import { storage, storageConnection } from "../storage/index.js";
import { deleteVersions, getVersions } from "../storage/VersionStorage.js";

/**
 * Keeps the text a note had before an editing session, as a version. Reports
 * nothing on failure: a version is a safety net under a save that already
 * happened, and the save has its own error. Never rejects.
 */
export async function recordVersion(
  noteId: string,
  title: string,
  content: string,
): Promise<void> {
  try {
    await storage.saveVersion(noteId, { title, content });
  } catch (err) {
    console.warn("Failed to save version:", err);
  }
}

/**
 * A note's history, newest first, or null if it could not be read.
 *
 * Connected mode's history is the server's, but a browser that kept one
 * before that has its own copy of this note's in `localStorage`. The first
 * time the note's history is opened here, that copy is sent across with its
 * own dates and then dropped, so it is neither lost nor shown twice.
 */
export async function loadVersions(
  noteId: string,
): Promise<NoteVersion[] | null> {
  try {
    // Same test as `currentStorage`: the server holds the history exactly
    // when the server holds the notes.
    const { serverUrl, token } = storageConnection.value;
    if (serverUrl !== null && token) await bringLocalVersionsAcross(noteId);
    return await storage.listVersions(noteId);
  } catch (err) {
    console.warn("Failed to load versions:", err);
    return null;
  }
}

async function bringLocalVersionsAcross(noteId: string): Promise<void> {
  const local = getVersions(noteId);
  if (local.length === 0) return;
  // Oldest first, so the server files them in the order they happened.
  for (const version of [...local].reverse()) {
    await storage.saveVersion(noteId, {
      title: version.title,
      content: version.content,
      timestamp: version.timestamp,
    });
  }
  deleteVersions(noteId);
}
