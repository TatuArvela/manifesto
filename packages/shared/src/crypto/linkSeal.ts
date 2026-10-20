import { base64urlToBytes, bytesToBase64url, wipe } from "./bytes.ts";
import { type NoteSealKey, noteSealKey } from "./noteKey.ts";
import {
  associatedData,
  derivable,
  deriveBytes,
  deriveKey,
  seal,
  unseal,
} from "./seal.ts";

/**
 * Public links (`docs/specification/features/encryption.md`, "Sharing").
 *
 * A public link contains a **link key** in the fragment of its address. No
 * browser sends the fragment to a server. The link key is not the token by
 * which the server finds the link, and the server never has it. A live link
 * stores the note key wrapped by it. Thus, the link follows the note. A
 * snapshot stores a copy of the note sealed under a key derived from it. Thus,
 * the link shows the note as it was. A person with the full address opens the
 * note. Nobody else can, also not the server.
 */

/** A link key as it goes in an address: 256 random bits as base64url. */
export const LINK_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newLinkKey(): string {
  return bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function baseOf(linkKey: string): Promise<CryptoKey | null> {
  if (!LINK_KEY_PATTERN.test(linkKey)) return null;
  const raw = base64urlToBytes(linkKey);
  try {
    return await derivable(raw);
  } finally {
    wipe(raw);
  }
}

function wrapData(noteId: string, keyVersion: number) {
  return associatedData({
    id: noteId,
    field: "link/note-key",
    version: keyVersion,
  });
}

/** The copy of the note key of a live link, wrapped by the link key. */
export async function wrapForLink(
  linkKey: string,
  noteId: string,
  keyVersion: number,
  noteKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const base = await baseOf(linkKey);
  if (!base) throw new Error("Not a link key");
  return seal(
    await deriveKey(base, "link/wrap"),
    noteKey,
    wrapData(noteId, keyVersion),
  );
}

/** The note key of a live link. Null when the link key does not open it. */
export async function openLinkedKey(
  linkKey: string,
  noteId: string,
  keyVersion: number,
  wrapped: string,
): Promise<NoteSealKey | null> {
  const base = await baseOf(linkKey);
  if (!base) return null;
  const raw = await unseal(
    await deriveKey(base, "link/wrap"),
    wrapped,
    wrapData(noteId, keyVersion),
  );
  if (!raw) return null;
  try {
    return await noteSealKey(raw, keyVersion);
  } finally {
    wipe(raw);
  }
}

/** The key under which the copy of the note of a snapshot link is sealed. */
export async function snapshotKey(
  linkKey: string,
): Promise<NoteSealKey | null> {
  const base = await baseOf(linkKey);
  if (!base) return null;
  const raw = await deriveBytes(base, "link/snapshot");
  try {
    return await noteSealKey(raw, 1);
  } finally {
    wipe(raw);
  }
}
