import { NOTE_VERSION_MAX_AGE_DAYS, type NoteVersion } from "@manifesto/shared";
import { storage, storageConnection } from "#/storage/index.ts";
import { deleteVersions, getVersions } from "#/storage/VersionStorage.ts";
import { notes } from "./notesStore.ts";

/**
 * Keeps the text that a note had before an editing session, as a version.
 * Reports nothing on failure. A version is a safety net under a save that
 * already occurred, and the save has its own error. Never rejects.
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
 * The history of a note, newest first, or null if the code could not read it.
 *
 * In connected mode, the history belongs to the server. But a browser that kept
 * one before that has its own copy of the history of this note in
 * `localStorage`. The first time that the history of the note opens here, that
 * copy goes across with its own dates, and is then dropped. Thus, it is not
 * lost, and does not show two times.
 */
export async function loadVersions(
  noteId: string,
): Promise<NoteVersion[] | null> {
  try {
    // The same test as `currentStorage`: the server keeps the history exactly
    // when the server keeps the notes.
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
  // Oldest first. Thus, the server files them in the order in which they
  // occurred.
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
 * Files the `versions.json` of an export under the notes that it just imported,
 * in both modes, with the dates on which they were taken. Only notes that this
 * user owns get one. A note whose id was the id of a shared note of a different
 * person was not imported, and must not get a history from a file. The code
 * skips a version that the note already has. Thus, an import of the same backup
 * two times adds nothing. It also skips a version past the age limit, which a
 * server would otherwise file as new. Reports nothing. The notes are what was
 * imported, and a history that could not be filed does not undo them. Never
 * rejects.
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
      // Oldest first. Thus, each is filed in the order in which it occurred.
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
