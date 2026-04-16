import type { NoteVersion } from "@manifesto/shared";
import { compressToUTF16, decompressFromUTF16 } from "lz-string";

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

function save(map: VersionMap): void {
  const json = JSON.stringify(map);
  localStorage.setItem(STORAGE_KEY, compressToUTF16(json));
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
