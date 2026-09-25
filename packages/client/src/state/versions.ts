import { NOTE_VERSION_MAX_AGE_DAYS, type NoteVersion } from "@manifesto/shared";
import { storage, storageConnection } from "../storage/index.js";
import { deleteVersions, getVersions } from "../storage/VersionStorage.js";
import { notes } from "./notesStore.js";

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

const versionKey = (v: Pick<NoteVersion, "timestamp" | "title" | "content">) =>
  `${Date.parse(v.timestamp)}\u0000${v.title}\u0000${v.content}`;

/**
 * Files an export's `versions.json` under the notes it has just imported, in
 * either mode, with the dates they were taken. Only notes this user owns get
 * one: a note whose id turned out to be someone else's shared note was not
 * imported, and must not be given a history from a file. A version the note
 * already has is skipped, so importing the same backup twice adds nothing,
 * and so is one past the age limit, which a server would otherwise file as
 * new. Reports nothing: the notes are what was imported, and a history that
 * could not be filed does not undo them. Never rejects.
 */
export async function restoreVersions(versions: NoteVersion[]): Promise<void> {
  const cutoff = Date.now() - NOTE_VERSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const byNote = new Map<string, NoteVersion[]>();
  for (const version of versions) {
    const at = Date.parse(version.timestamp);
    if (Number.isNaN(at) || at < cutoff || at > Date.now()) continue;
    const list = byNote.get(version.noteId) ?? [];
    list.push(version);
    byNote.set(version.noteId, list);
  }
  for (const [noteId, list] of byNote) {
    const note = notes.value.find((n) => n.id === noteId);
    if (!note || (note.sharing?.role ?? "owner") !== "owner") continue;
    try {
      const held = new Set(
        (await storage.listVersions(noteId)).map(versionKey),
      );
      // Oldest first, so each is filed in the order it happened.
      list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      for (const version of list) {
        if (held.has(versionKey(version))) continue;
        held.add(versionKey(version));
        await storage.saveVersion(noteId, {
          title: version.title,
          content: version.content,
          timestamp: version.timestamp,
        });
      }
    } catch (err) {
      console.warn("Failed to restore versions:", err);
    }
  }
}
