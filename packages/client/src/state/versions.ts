import {
  imageAltsOf,
  NOTE_VERSION_MAX_AGE_DAYS,
  type Note,
  type NoteVersion,
} from "@manifesto/shared";
import { storage, storageConnection } from "#/storage/index.ts";
import type { VersionInput } from "#/storage/StorageAdapter.ts";
import { deleteVersions, getVersions } from "#/storage/VersionStorage.ts";
import { notes } from "./notesStore.ts";

/**
 * Keeps the text and the images that a note had before an editing session, as
 * a version. Without `images`, the version keeps none. Reports nothing on
 * failure. A version is a safety net under a save that already occurred, and
 * the save has its own error. Never rejects.
 */
export async function recordVersion(
  noteId: string,
  version: Omit<VersionInput, "timestamp">,
): Promise<void> {
  try {
    await storage.saveVersion(noteId, version);
  } catch (err) {
    console.warn("Failed to save version:", err);
  }
}

/** What a note was when its editor opened, for the version of the session. */
export interface NoteBefore {
  title: string;
  content: string;
  /** Null until the images of the note have arrived. */
  images: Pick<Note, "images" | "imageAlts"> | null;
}

const sameImages = (
  a: Pick<Note, "images" | "imageAlts">,
  b: Pick<Note, "images" | "imageAlts">,
) => {
  const altsA = imageAltsOf(a);
  const altsB = imageAltsOf(b);
  return (
    a.images.length === b.images.length &&
    a.images.every((ref, i) => ref === b.images[i] && altsA[i] === altsB[i])
  );
};

/**
 * The version to keep when an editing session ends: the note as it was before
 * it, when its title, its text or its images changed. Null when nothing did.
 * The images are in it only when they arrived before the session ended.
 */
export function versionToKeep(
  noteId: string,
  before: NoteBefore,
  title: string,
  content: string,
): Omit<VersionInput, "timestamp"> | null {
  const now = notes.value.find((n) => n.id === noteId);
  const images = before.images;
  const imagesChanged =
    images !== null && now !== undefined && !sameImages(images, now);
  if (title === before.title && content === before.content && !imagesChanged) {
    return null;
  }
  return {
    title: before.title,
    content: before.content,
    ...(images && {
      images: images.images,
      ...(images.imageAlts && { imageAlts: images.imageAlts }),
    }),
  };
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
