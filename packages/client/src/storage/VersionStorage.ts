import {
  MAX_NOTE_VERSIONS,
  NOTE_VERSION_MAX_AGE_DAYS,
  type NoteVersion,
  upgradeNoteWords,
} from "@manifesto/shared";
import { compressToUTF16, decompressFromUTF16 } from "lz-string";
import { isQuotaError, reportQuotaRefusal } from "./quota.ts";

/**
 * One key for each note, `manifesto:versions:<id>`, each an LZ-compressed list.
 *
 * One for each note. Thus, a save of a version costs the history of one note.
 * LZ-String compresses at a few MB each second, and a history in frequent use
 * is several MB of JSON. Thus, a new compression of the history of each note on
 * each save would freeze the page when the editor closes.
 */
const KEY_PREFIX = "manifesto:versions:";
/**
 * The single shared key that the keys for each note replaced. Migrated on first
 * use.
 */
const LEGACY_KEY = "manifesto:versions";
const MAX_VERSIONS_PER_NOTE = MAX_NOTE_VERSIONS;
const MAX_AGE_MS = NOTE_VERSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

type VersionMap = Record<string, NoteVersion[]>;

const keyFor = (noteId: string) => `${KEY_PREFIX}${noteId}`;

function decode<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const json = decompressFromUTF16(raw);
    if (!json) return fallback;
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** Writes the list of one note, or reports if the browser refused it. */
function write(noteId: string, versions: NoteVersion[]): "ok" | "quota" {
  try {
    localStorage.setItem(
      keyFor(noteId),
      compressToUTF16(JSON.stringify(versions)),
    );
    return "ok";
  } catch (err) {
    if (isQuotaError(err)) return "quota";
    throw err;
  }
}

let migrated = false;

/**
 * Splits the old shared map into keys for each note, one time. The shared key
 * is dropped only after its notes are written. Thus, a refusal halfway makes
 * its space free and tries the note again, and does not lose the remaining
 * notes.
 */
function migrateLegacy(): void {
  if (migrated) return;
  migrated = true;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (raw === null) return;
  const map = decode<VersionMap>(raw, {});
  let legacyRemoved = false;
  for (const [noteId, versions] of Object.entries(map)) {
    if (!Array.isArray(versions) || versions.length === 0) continue;
    if (write(noteId, versions) === "ok") continue;
    if (!legacyRemoved) {
      localStorage.removeItem(LEGACY_KEY);
      legacyRemoved = true;
      if (write(noteId, versions) === "ok") continue;
    }
    reportQuotaRefusal();
  }
  localStorage.removeItem(LEGACY_KEY);
}

function load(noteId: string): NoteVersion[] {
  migrateLegacy();
  const versions = decode<unknown>(localStorage.getItem(keyFor(noteId)), []);
  return Array.isArray(versions) ? (versions as NoteVersion[]) : [];
}

/**
 * Adds a version, now or, when the code brings one back from an export, at the
 * `timestamp` on which it was taken. Kept oldest first. Thus, both limits trim
 * from the front, and a version that is already past the age limit is not kept.
 */
export function saveVersion(
  noteId: string,
  title: string,
  content: string,
  timestamp?: string,
  images?: {
    images?: string[] | undefined;
    imageAlts?: string[] | undefined;
  },
): void {
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;
  const at = timestamp === undefined ? now : Date.parse(timestamp);
  if (Number.isNaN(at) || at < cutoff || at > now) return;

  const fresh = load(noteId).filter(
    (v) => new Date(v.timestamp).getTime() >= cutoff,
  );

  fresh.push({
    noteId,
    timestamp: new Date(at).toISOString(),
    title,
    content,
    ...(images?.images !== undefined && { images: images.images }),
    ...(images?.imageAlts !== undefined && { imageAlts: images.imageAlts }),
  });
  if (timestamp !== undefined) {
    fresh.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  if (fresh.length > MAX_VERSIONS_PER_NOTE) {
    fresh.splice(0, fresh.length - MAX_VERSIONS_PER_NOTE);
  }

  if (write(noteId, fresh) === "ok") return;
  // No space: give up the oldest version of this note for the new one, one
  // time.
  reportQuotaRefusal();
  if (fresh.length > 1) write(noteId, fresh.slice(1));
}

export function getVersions(noteId: string): NoteVersion[] {
  // Newest first: the history panel lists the most recent at the top.
  return [...load(noteId)].reverse();
}

export function deleteVersions(noteId: string): void {
  migrateLegacy();
  localStorage.removeItem(keyFor(noteId));
}

/**
 * Brings the versions of each note from `from` up to the current format, as the
 * open-mode store does with its notes (`LocalStorageAdapter`), which records
 * the format for both. The code does not change a list that does not read.
 */
export function upgradeAllVersions(from: number): void {
  migrateLegacy();
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) ids.push(key.slice(KEY_PREFIX.length));
  }
  for (const noteId of ids) {
    const versions = load(noteId);
    if (versions.length === 0) continue;
    if (
      write(
        noteId,
        versions.map((v) => upgradeNoteWords(v, from)),
      ) !== "ok"
    ) {
      reportQuotaRefusal();
    }
  }
}

/**
 * Each image reference that a kept version names. Thus, the sweep of images to
 * which no note refers keeps those that a restore can bring back.
 */
export function versionImageRefs(): string[] {
  migrateLegacy();
  const refs: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(KEY_PREFIX)) continue;
    for (const version of load(key.slice(KEY_PREFIX.length))) {
      if (!Array.isArray(version.images)) continue;
      refs.push(...version.images.filter((r) => typeof r === "string"));
    }
  }
  return refs;
}

/** For tests: run the legacy migration again on the next access. */
export function resetVersionMigrationForTests(): void {
  migrated = false;
}
