import {
  type ImageKey,
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
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { apiFetch } from "../storage/apiRequest.js";
import { storageConnection } from "../storage/index.js";
import { sealer } from "../storage/sealing.js";
import { sealedNote } from "../storage/shareKeys.js";

/**
 * Public links: a note published to anyone holding its link, from a server
 * row the owner can revoke (unlike the fragment share link, which carries the
 * note itself and can never be taken back).
 *
 * The owner's half goes through `apiFetch` like the rest of sharing. The
 * viewer's half is a page with no account, so it asks the server with plain
 * `fetch`. Like the other account-level calls, each resolves with what
 * happened and never rejects.
 *
 * The note a link shows is sealed. What opens it is the **link key**, which
 * rides in the fragment of the link's address (`#k=`), where no browser sends
 * it to a server: the owner's app makes it, and the page reads it from its
 * own address.
 */

/** The note whose public links dialog is open, set from the note menu. */
export const publicLinksDialog = signal<{ noteId: string } | null>(null);

/** Vite's `BASE_URL` without its trailing slash, as the router has it. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** A public link's address, on the page this app is served from, with the
 * link key in its fragment when there is one. */
export function publicLinkUrl(token: string, linkKey?: string): string {
  const key = linkKey ? `#k=${linkKey}` : "";
  return `${window.location.origin}${BASE}/p/${token}${key}`;
}

/**
 * The whole address of one of the owner's links, to copy: its key opened
 * from the copy the server keeps sealed for them. Null when the key does not
 * open, and then there is no address that would show the note.
 */
export async function publicLinkAddress(
  link: PublicLink,
): Promise<string | null> {
  const sealing = sealer.peek();
  if (!sealing) return null;
  // Sealing handed through (a test) has no link key to add.
  if (!sealing.handsKeysOn) return publicLinkUrl(link.token);
  try {
    const key = await sealing.openLinkKey(link.noteId, link.sealedLinkKey);
    return key ? publicLinkUrl(link.token, key) : null;
  } catch {
    return null;
  }
}

/** The link key in an address's fragment, or null. */
export function linkKeyOf(hash: string): string | null {
  const key = new URLSearchParams(hash.replace(/^#/, "")).get("k");
  return key && LINK_KEY_PATTERN.test(key) ? key : null;
}

/** The token when `pathname` is a public link's page, else null. */
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
 * Publishes `note`. The link key is made here; the server is sent the note
 * key wrapped by it (a live link) or the note sealed under it (a snapshot),
 * and never the key.
 */
export async function createPublicLink(
  note: Note,
  request: Omit<
    PublicLinkCreateRequest,
    "sealedLinkKey" | "wrappedKey" | "snapshot"
  >,
): Promise<PublicLink | null> {
  // Locked: there is no key to give the link, and one without it opens
  // nothing.
  const sealing = sealer.peek();
  if (!sealing) {
    console.warn("Cannot seal a note for its link while locked");
    return null;
  }
  let fields: object = {};
  try {
    const made = await sealing.publish(note, request.mode, sealedNote(note.id));
    if (made) fields = made.fields;
  } catch (err) {
    console.warn("Failed to seal a note for its link:", err);
    return null;
  }
  const res = await apiFetch("POST", `/notes/${note.id}/links`, {
    ...request,
    ...fields,
  });
  if (!res?.ok) return null;
  return ((await res.json()) as PublicLinkResponse).link;
}

export async function revokePublicLink(
  noteId: string,
  token: string,
): Promise<boolean> {
  const res = await apiFetch("DELETE", `/notes/${noteId}/links/${token}`);
  return res?.ok ?? false;
}

/** A public link's note as its page shows it, opened. A link carries no
 * colour: that is the owner's own, under a key no link has. */
export interface ShownPublicNote {
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  images: string[];
  linkPreviews: LinkPreview[];
  updatedAt: string;
}

/** What opens each picture of the note being shown, by its reference. */
const imageKeys = new Map<string, ImageKey>();

/** What opening a public link came to. */
export type PublicNoteResult =
  | { kind: "note"; note: ShownPublicNote; access: string | null }
  | { kind: "locked" }
  | { kind: "wrong-password" }
  | { kind: "too-many" }
  | { kind: "gone" }
  | { kind: "failed" };

async function readPublicNote(res: Response | null): Promise<PublicNoteResult> {
  if (!res) return { kind: "failed" };
  if (res.status === 401) return { kind: "locked" };
  if (res.status === 403) return { kind: "wrong-password" };
  if (res.status === 429) return { kind: "too-many" };
  if (res.status === 404) return { kind: "gone" };
  if (!res.ok) return { kind: "failed" };
  const body = (await res.json()) as PublicNoteResponse;
  // Without the link key, or with one that opens nothing, there is no note
  // to show: the same as a link that is not there.
  const linkKey = linkKeyOf(window.location.hash);
  if (!linkKey) return { kind: "gone" };
  const { note } = body;
  let key: NoteSealKey | null;
  try {
    key = body.wrappedKey
      ? await openLinkedKey(linkKey, note.id, note.keyVersion, body.wrappedKey)
      : await snapshotKey(linkKey);
  } catch {
    key = null;
  }
  // A snapshot's key is derived from whatever the address holds, so another
  // link's key gives one too; only the words opening tell it is this note's.
  const opened = key && (await openSharedFieldsUnder(key, note.id, note));
  if (!opened) return { kind: "gone" };
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
  // The server this build was made for, as `auth.ts` hands it to storage;
  // `=== null`, since a same-origin server's base is "".
  const { serverUrl } = storageConnection.value;
  if (serverUrl === null) return null;
  try {
    return await fetch(`${serverUrl}/api/public/${path}`, init);
  } catch {
    return null;
  }
}

/** Open a public link. Counts a view unless it asks for a password. */
export async function openPublicNote(token: string): Promise<PublicNoteResult> {
  return readPublicNote(await publicFetch(token));
}

/** Give a public link its password. Counts a view when it is right. */
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
 * A picture a public note shows, as an object URL for an `<img>`, or null.
 * Fetched rather than linked so the password's proof can go in a header, and
 * so the page's CSP needs nothing it does not already allow (`blob:`).
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
  // Sealed, like every image: opened with the key the note holds for it,
  // and shown only if it is the kind of image the note says.
  const key = imageKeys.get(ref);
  if (!key) return null;
  const image = await openImage(key, new Uint8Array(await res.arrayBuffer()));
  return image
    ? URL.createObjectURL(new Blob([image], { type: key.type }))
    : null;
}
