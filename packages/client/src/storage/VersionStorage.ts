import type { NoteVersion } from "@manifesto/shared";
import { compressToUTF16, decompressFromUTF16 } from "lz-string";
import { reportStorageQuotaExceeded } from "./quotaReporter.js";

const STORAGE_KEY = "manifesto:versions";
const MAX_VERSIONS_PER_NOTE = 50;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

type VersionMap = Record<string, NoteVersion[]>;

function load(): VersionMap {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const json = decompressFromUTF16(raw);
    if (!json) return {};
    return JSON.parse(json) as VersionMap;
  } catch {
    return {};
  }
}

function save(map: VersionMap): boolean {
  const json = JSON.stringify(map);
  try {
    localStorage.setItem(STORAGE_KEY, compressToUTF16(json));
    return true;
  } catch (err) {
    // QuotaExceededError under heavy use (50 versions × N notes). Drop the
    // oldest version from each note and try once more before giving up.
    if (isQuotaError(err)) {
      const trimmed: VersionMap = {};
      for (const [id, versions] of Object.entries(map)) {
        if (versions.length > 1) trimmed[id] = versions.slice(1);
      }
      try {
        localStorage.setItem(
          STORAGE_KEY,
          compressToUTF16(JSON.stringify(trimmed)),
        );
        reportStorageQuotaExceeded();
        return true;
      } catch {
        reportStorageQuotaExceeded();
        return false;
      }
    }
    throw err;
  }
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" ||
      // Old WebKit / Firefox surface a different name + numeric code
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22)
  );
}

export function saveVersion(
  noteId: string,
  title: string,
  content: string,
): void {
  const map = load();
  const versions = map[noteId] ?? [];
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;

  // Prune old versions
  const fresh = versions.filter(
    (v) => new Date(v.timestamp).getTime() >= cutoff,
  );

  // Add new version
  fresh.push({
    noteId,
    timestamp: new Date(now).toISOString(),
    title,
    content,
  });

  // Cap at max, keeping newest (end of array)
  if (fresh.length > MAX_VERSIONS_PER_NOTE) {
    fresh.splice(0, fresh.length - MAX_VERSIONS_PER_NOTE);
  }

  map[noteId] = fresh;
  save(map);
}

export function getVersions(noteId: string): NoteVersion[] {
  const map = load();
  const versions = map[noteId] ?? [];
  // Return newest first
  return [...versions].reverse();
}

export function deleteVersions(noteId: string): void {
  const map = load();
  if (!(noteId in map)) return;
  delete map[noteId];
  save(map);
}
