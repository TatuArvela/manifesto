import type { NoteColor, NoteFont } from "@manifesto/shared";
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

/** The subset of note fields that are shared via URL. */
export interface SharedNotePayload {
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  tags: string[];
}

const HASH_PREFIX = "#share=";

/** Encode a note payload into a share URL hash fragment (without the leading #). */
export function encodeSharePayload(payload: SharedNotePayload): string {
  const json = JSON.stringify(payload);
  return `share=${compressToEncodedURIComponent(json)}`;
}

/** Build a full share URL for the current origin. */
export function buildShareUrl(payload: SharedNotePayload): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}#${encodeSharePayload(payload)}`;
}

/** Try to decode a share payload from the current URL hash. Returns null if not a share URL. */
export function decodeShareFromHash(hash: string): SharedNotePayload | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;

  const compressed = hash.slice(HASH_PREFIX.length);
  if (!compressed) return null;

  try {
    const json = decompressFromEncodedURIComponent(compressed);
    if (!json) return null;

    const parsed = JSON.parse(json);
    if (!isValidPayload(parsed)) return null;

    return parsed;
  } catch {
    return null;
  }
}

/** Clear the share hash from the URL without triggering a navigation. */
export function clearShareHash(): void {
  history.replaceState(null, "", window.location.pathname);
}

function isValidPayload(value: unknown): value is SharedNotePayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.title === "string" &&
    typeof obj.content === "string" &&
    typeof obj.color === "string" &&
    typeof obj.font === "string" &&
    Array.isArray(obj.tags) &&
    obj.tags.every((t: unknown) => typeof t === "string")
  );
}
