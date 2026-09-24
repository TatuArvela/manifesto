import {
  MAX_NOTE_VERSIONS,
  NOTE_VERSION_MAX_AGE_DAYS,
  type NoteVersion,
} from "@manifesto/shared";
import { compressToUTF16, decompressFromUTF16 } from "lz-string";
import { isQuotaError, reportQuotaRefusal } from "./quota.js";

/**
 * One key per note, `manifesto:versions:<id>`, each an LZ-compressed list.
 *
 * Per note so that saving a version costs one note's history. LZ-String
 * compresses at a few MB a second and a well-used history is several MB of
 * JSON, so re-compressing every note's history on each save would freeze the
 * page as the editor closes.
 */
const KEY_PREFIX = "manifesto:versions:";
/** The single shared key the per-note ones replaced; migrated on first use. */
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

/** Writes one note's list, or reports whether the browser refused it. */
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
 * Splits the old shared map into per-note keys, once. The shared key is
 * dropped only after its notes are written, so a refusal part way through
 * frees its space and tries the note again rather than losing the rest.
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

export function saveVersion(
  noteId: string,
  title: string,
  content: string,
): void {
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;

  // Stored oldest-first, so both limits trim from the front.
  const fresh = load(noteId).filter(
    (v) => new Date(v.timestamp).getTime() >= cutoff,
  );

  fresh.push({
    noteId,
    timestamp: new Date(now).toISOString(),
    title,
    content,
  });

  if (fresh.length > MAX_VERSIONS_PER_NOTE) {
    fresh.splice(0, fresh.length - MAX_VERSIONS_PER_NOTE);
  }

  if (write(noteId, fresh) === "ok") return;
  // Out of room: give up this note's oldest version for the new one, once.
  reportQuotaRefusal();
  if (fresh.length > 1) write(noteId, fresh.slice(1));
}

export function getVersions(noteId: string): NoteVersion[] {
  // Newest first: the history panel lists most-recent at the top.
  return [...load(noteId)].reverse();
}

export function deleteVersions(noteId: string): void {
  migrateLegacy();
  localStorage.removeItem(keyFor(noteId));
}

/** For tests: run the legacy migration again on the next access. */
export function resetVersionMigrationForTests(): void {
  migrated = false;
}
