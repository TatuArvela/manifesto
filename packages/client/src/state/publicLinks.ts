import {
  type ImageKey,
  isNewerNoteFormat,
  LINK_KEY_PATTERN,
  type LinkPreview,
  type Note,
  NoteColor,
  type NoteFont,
  type NoteSealKey,
  openImage,
  openLinkedKey,
  openSharedFieldsUnder,
  type PublicLink,
  type PublicLinkCreateRequest,
  type PublicLinkResponse,
  type PublicLinksResponse,
  type PublicNoteResponse,
  snapshotKey,
  upgradeNoteWords,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { apiFetch } from "#/storage/apiRequest.ts";
import { storageConnection } from "#/storage/index.ts";
import { sealer } from "#/storage/sealing.ts";
import { sealedNote } from "#/storage/shareKeys.ts";

/**
 * Public links: a note published to each person who has its link, from a server
 * row that the owner can revoke (as the fragment share link cannot, because it
 * carries the note itself and can never be taken back).
 *
 * The half of the owner goes through `apiFetch`, as the remaining sharing code
 * does. The half of the viewer is a page with no account. Thus, it asks the
 * server with plain `fetch`. As the other account-level calls do, each resolves
 * with what occurred, and never rejects.
 *
 * The note that a link shows is sealed. The **link key** opens it. The key is
 * in the fragment of the address of the link (`#k=`), which no browser sends to
 * a server. The app of the owner makes it, and the page reads it from its own
 * address.
 */

/** The note whose public links dialog is open, set from the note menu. */
export const publicLinksDialog = signal<{ noteId: string } | null>(null);

/** The `BASE_URL` of Vite without its trailing slash, as the router has it. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * The address of a public link, on the page from which this app is served, with
 * the link key in its fragment when there is one.
 */
export function publicLinkUrl(token: string, linkKey?: string): string {
  const key = linkKey ? `#k=${linkKey}` : "";
  return `${window.location.origin}${BASE}/p/${token}${key}`;
}

/**
 * The full address of one of the links of the owner, to copy. Its key is opened
 * from the copy that the server keeps sealed for them. Null when the key does
 * not open. Then there is no address that would show the note.
 */
export async function publicLinkAddress(
  link: PublicLink,
): Promise<string | null> {
  const sealing = sealer.peek();
  if (!sealing) return null;
  // When the seal is skipped (a test), there is no link key to add.
  if (!sealing.handsKeysOn) return publicLinkUrl(link.token);
  try {
    const key = await sealing.openLinkKey(link.noteId, link.sealedLinkKey);
    return key ? publicLinkUrl(link.token, key) : null;
  } catch {
    return null;
  }
}

/** The link key in the fragment of an address, or null. */
export function linkKeyOf(hash: string): string | null {
  const key = new URLSearchParams(hash.replace(/^#/, "")).get("k");
  return key && LINK_KEY_PATTERN.test(key) ? key : null;
}

/** The token when `pathname` is the page of a public link, else null. */
export function publicLinkToken(pathname: string): string | null {
  const rest =
    BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const match = /^\/p\/([A-Za-z0-9_-]{16,64})\/?$/.exec(rest);
  return match?.[1] ?? null;
}

export async function listPublicLinks(
  noteId: string,
): Promise<PublicLink[] | null> {
  const res = await apiFetch("GET", `/notes/${noteId}/links`);
  if (!res?.ok) return null;
  return ((await res.json()) as PublicLinksResponse).links;
}

/**
 * Publishes `note`. The link key is made here. The server gets the note key
 * wrapped by it (a live link) or the note sealed under it (a snapshot), and
 * never the key. Resolves with the new link and its full address, or null when
 * the code could not make it.
 */
export async function createPublicLink(
  note: Note,
  request: Omit<
    PublicLinkCreateRequest,
    "sealedLinkKey" | "wrappedKey" | "snapshot"
  >,
): Promise<{ link: PublicLink; address: string } | null> {
  // Locked: there is no key to give the link, and a link without it opens
  // nothing.
  const sealing = sealer.peek();
  if (!sealing) {
    console.warn("Cannot seal a note for its link while locked");
    return null;
  }
  let made: Awaited<ReturnType<typeof sealing.publish>>;
  try {
    made = await sealing.publish(note, request.mode, sealedNote(note.id));
  } catch (err) {
    console.warn("Failed to seal a note for its link:", err);
    return null;
  }
  // Only a skipped seal (a test) makes a link with no key. A real link sent
  // without the sealed parts would never open.
  if (!made && sealing.handsKeysOn) {
    console.warn("Failed to seal a note for its link");
    return null;
  }
  try {
    const res = await apiFetch("POST", `/notes/${note.id}/links`, {
      ...request,
      ...made?.fields,
    });
    if (!res?.ok) return null;
    const { link } = (await res.json()) as PublicLinkResponse;
    return { link, address: publicLinkUrl(link.token, made?.linkKey) };
  } catch (err) {
    console.warn("Failed to create a public link:", err);
    return null;
  }
}

export async function revokePublicLink(
  noteId: string,
  token: string,
): Promise<boolean> {
  const res = await apiFetch("DELETE", `/notes/${noteId}/links/${token}`);
  return res?.ok ?? false;
}

/**
 * The note of a public link as its page shows it, opened. A link carries no
 * color. The color belongs to the owner, under a key that no link has.
 */
export interface ShownPublicNote {
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  images: string[];
  /** In agreement with `images`, as on a note. */
  imageAlts?: string[];
  linkPreviews: LinkPreview[];
  updatedAt: string;
}

/** What opens each picture of the note that shows, by its reference. */
const imageKeys = new Map<string, ImageKey>();

/** The result of the open of a public link. */
export type PublicNoteResult =
  | { kind: "note"; note: ShownPublicNote; access: string | null }
  | { kind: "locked" }
  | { kind: "wrong-password" }
  | { kind: "too-many" }
  | { kind: "gone" }
  /** Saved by a newer version of the app than this page. */
  | { kind: "newer" }
  | { kind: "failed" };

async function readPublicNote(res: Response | null): Promise<PublicNoteResult> {
  if (!res) return { kind: "failed" };
  if (res.status === 401) return { kind: "locked" };
  if (res.status === 403) return { kind: "wrong-password" };
  if (res.status === 429) return { kind: "too-many" };
  if (res.status === 404) return { kind: "gone" };
  if (!res.ok) return { kind: "failed" };
  const body = (await res.json()) as PublicNoteResponse;
  // Without the link key, or with a key that opens nothing, there is no note to
  // show: the same as a link that does not exist.
  const linkKey = linkKeyOf(window.location.hash);
  if (!linkKey) return { kind: "gone" };
  const { note } = body;
  if (isNewerNoteFormat(note.format)) return { kind: "newer" };
  let key: NoteSealKey | null;
  try {
    key = body.wrappedKey
      ? await openLinkedKey(linkKey, note.id, note.keyVersion, body.wrappedKey)
      : await snapshotKey(linkKey);
  } catch {
    key = null;
  }
  // The key of a snapshot comes from the content of the address. Thus, the key
  // of a different link also gives one. Only the open of the words tells that
  // it is the key of this note.
  const sealedWords = key && (await openSharedFieldsUnder(key, note.id, note));
  if (!sealedWords) return { kind: "gone" };
  const opened = upgradeNoteWords(sealedWords, note.format);
  imageKeys.clear();
  for (const [ref, imageKey] of opened.imageKeys) imageKeys.set(ref, imageKey);
  return {
    kind: "note",
    note: {
      title: opened.title,
      content: opened.content,
      color: NoteColor.Default,
      font: opened.font,
      images: opened.images,
      ...(opened.imageAlts !== undefined && { imageAlts: opened.imageAlts }),
      linkPreviews: opened.linkPreviews,
      updatedAt: note.updatedAt,
    },
    access: body.access,
  };
}

async function publicFetch(
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  // The server for which this build was made, as `auth.ts` gives it to storage.
  // `=== null`, because the base of a same-origin server is "".
  const { serverUrl } = storageConnection.value;
  if (serverUrl === null) return null;
  try {
    return await fetch(`${serverUrl}/api/v1/public/${path}`, init);
  } catch {
    return null;
  }
}

/** Open a public link. Counts a view, unless it asks for a password. */
export async function openPublicNote(token: string): Promise<PublicNoteResult> {
  return readPublicNote(await publicFetch(token));
}

/** Give a public link its password. Counts a view when it is correct. */
export async function unlockPublicNote(
  token: string,
  password: string,
): Promise<PublicNoteResult> {
  return readPublicNote(
    await publicFetch(`${token}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
}

/**
 * A picture that a public note shows, as an object URL for an `<img>`, or null.
 * Loaded, not linked. Thus, the proof of the password can go in a header, and
 * the CSP of the page needs nothing that it does not already permit (`blob:`).
 */
export async function loadPublicImage(
  token: string,
  ref: string,
  access: string | null,
): Promise<string | null> {
  const id = ref.startsWith("attachment:") ? ref.slice(11) : null;
  if (!id) return null;
  const res = await publicFetch(`${token}/attachments/${id}`, {
    headers: access ? { "X-Link-Access": access } : {},
  });
  if (!res?.ok) return null;
  // Sealed, as each image is. Opened with the key that the note has for it, and
  // shown only if it is the kind of image that the note says.
  const key = imageKeys.get(ref);
  if (!key) return null;
  const image = await openImage(key, new Uint8Array(await res.arrayBuffer()));
  return image
    ? URL.createObjectURL(new Blob([image], { type: key.type }))
    : null;
}
