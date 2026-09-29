import type {
  PublicLink,
  PublicLinkCreateRequest,
  PublicLinkResponse,
  PublicLinksResponse,
  PublicNote,
  PublicNoteResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { apiFetch } from "../storage/apiRequest.js";
import { storageConnection } from "../storage/index.js";

/**
 * Public links: a note published to anyone holding its link, from a server
 * row the owner can revoke (unlike the fragment share link, which carries the
 * note itself and can never be taken back).
 *
 * The owner's half goes through `apiFetch` like the rest of sharing. The
 * viewer's half is a page with no account, so it asks the server with plain
 * `fetch`. Like the other account-level calls, each resolves with what
 * happened and never rejects.
 */

/** The note whose public links dialog is open, set from the note menu. */
export const publicLinksDialog = signal<{ noteId: string } | null>(null);

/** Vite's `BASE_URL` without its trailing slash, as the router has it. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** A public link's address, on the page this app is served from. */
export function publicLinkUrl(token: string): string {
  return `${window.location.origin}${BASE}/p/${token}`;
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

export async function createPublicLink(
  noteId: string,
  request: PublicLinkCreateRequest,
): Promise<PublicLink | null> {
  const res = await apiFetch("POST", `/notes/${noteId}/links`, request);
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

/** What opening a public link came to. */
export type PublicNoteResult =
  | { kind: "note"; note: PublicNote; access: string | null }
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
  return { kind: "note", note: body.note, access: body.access };
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
  return URL.createObjectURL(await res.blob());
}
