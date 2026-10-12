import { createHash } from "node:crypto";
import {
  CIPHERTEXT_PREFIX,
  isAttachmentRef,
  type NoteCreate,
  type NoteUpdate,
  SEALED_IMAGE_OVERHEAD,
  type SealedNote,
  type SealedNoteVersion,
  type ShareInvitation,
  sniffImageType,
} from "@manifesto/shared";
import { newId } from "../lib/ulid.js";
import {
  ct,
  opened,
  plain,
  sealedCreate,
  sealedUpdate,
} from "../storage/contracts/claimed.js";

/**
 * A test's requests, sent the way the app sends them. The app seals a note
 * before it leaves the browser and opens what comes back, so a test that
 * speaks of a note's title in plain words is speaking as the app's user does:
 * this stands where the app's own sealing would, with values that are only
 * shaped as ciphertext (`ct`), since the server never opens one.
 *
 * An image is uploaded sealed, under an address made from its bytes, and
 * made the owner's of the note about to name it, as the app does both.
 *
 * A request made with a token is left as it is: a script sends readable
 * notes. So is a body that is already sealed, or that is not a note at all,
 * which is how a test of what the server refuses gets its body through.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const TOKEN = /^Bearer mf[a-z]_/;

/** The fields that hold someone's words wherever they turn up. */
const WORDS = new Set(["title", "content", "excerpt"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The body as the app would send it, or null to send it as given. */
function sealedBody(method: string, path: string, body: unknown): unknown {
  if (!isRecord(body)) return null;
  if (method === "POST" && path === "/api/notes") {
    if ("key" in body) return null;
    return sealedCreate(body as unknown as NoteCreate);
  }
  if (method === "POST" && path === "/api/notes/import") {
    if (!Array.isArray(body.notes)) return null;
    return {
      notes: body.notes.map((note: unknown) => {
        if (!isRecord(note) || "key" in note) return note;
        const { id, createdAt, ...fields } = note;
        return {
          ...sealedCreate(
            fields as unknown as NoteCreate,
            typeof id === "string" ? id : newId(),
          ),
          ...(createdAt !== undefined && { createdAt }),
        };
      }),
    };
  }
  if (method === "PUT" && /^\/api\/notes\/[^/]+$/.test(path)) {
    return sealedUpdate(body as NoteUpdate);
  }
  if (method === "POST" && /^\/api\/notes\/[^/]+\/versions$/.test(path)) {
    if ("keyVersion" in body) return null;
    const { title, content, ...rest } = body;
    return {
      id: newId(),
      keyVersion: 1,
      ...rest,
      title: typeof title === "string" ? ct(title) : title,
      content: typeof content === "string" ? ct(content) : content,
    };
  }
  if (method === "PATCH" && path === "/api/auth/me/prefs") {
    if (!isRecord(body.prefs)) return null;
    return {
      prefs: Object.fromEntries(
        Object.entries(body.prefs).map(([key, value]) => [
          key,
          value === null ? null : ct(JSON.stringify(value)),
        ]),
      ),
    };
  }
  return null;
}

function isSealedNote(value: Record<string, unknown>): boolean {
  return (
    typeof value.keyVersion === "number" &&
    typeof value.key === "string" &&
    typeof value.title === "string"
  );
}

function isSealedVersion(value: Record<string, unknown>): boolean {
  return (
    typeof value.keyVersion === "number" &&
    typeof value.noteId === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.title === "string"
  );
}

/** Everything sealed in an answer, read back as the app would show it. */
export function openedAnswer(value: unknown, path = ""): unknown {
  if (Array.isArray(value))
    return value.map((item) => openedAnswer(item, path));
  if (!isRecord(value)) return value;
  if (isSealedNote(value)) return opened(value as unknown as SealedNote);
  if (isSealedVersion(value)) {
    const version = value as unknown as SealedNoteVersion;
    return {
      noteId: version.noteId,
      timestamp: version.timestamp,
      title: plain(version.title),
      content: plain(version.content),
    };
  }
  if (path.endsWith("/auth/me/prefs") && isRecord(value.prefs)) {
    return {
      ...value,
      prefs: Object.fromEntries(
        Object.entries(value.prefs).map(([key, sealed]) => [
          key,
          typeof sealed === "string" ? JSON.parse(plain(sealed)) : sealed,
        ]),
      ),
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      // A sealed value outside a note (an invitation's title, say) reads as
      // the words it holds.
      WORDS.has(key) &&
      typeof item === "string" &&
      item.startsWith(CIPHERTEXT_PREFIX)
        ? plain(item)
        : openedAnswer(item, path),
    ]),
  );
}

/** The nonce and tag a sealed image carries, as so many zero bytes. */
const IMAGE_FILLER = SEALED_IMAGE_OVERHEAD;

/** An upload as the app sends one: sealed, under the address its bytes give. */
function sealedUpload(init: RequestInit): RequestInit | null {
  const { body } = init;
  if (!(body instanceof Uint8Array)) return null;
  const headers = new Headers(init.headers);
  if (headers.has("X-Attachment-Address")) return null;
  const sealed = new Uint8Array(IMAGE_FILLER + body.length);
  sealed.set(body, IMAGE_FILLER);
  headers.set(
    "X-Attachment-Address",
    createHash("sha256").update(body).digest("base64url"),
  );
  headers.set("Content-Type", "application/octet-stream");
  return { ...init, headers, body: sealed as BodyInit };
}

/** A served image as the app shows it: opened, and of the kind it is. */
async function openedImage(res: Response): Promise<Response> {
  const sealed = new Uint8Array(await res.arrayBuffer());
  const image = sealed.subarray(IMAGE_FILLER);
  const headers = new Headers(res.headers);
  headers.set(
    "Content-Type",
    sniffImageType(image) ?? "application/octet-stream",
  );
  headers.delete("Content-Length");
  return new Response(image, { status: res.status, headers });
}

const ATTACHMENT = /\/attachments\/[^/]+$/;

/** The attachment references a note's body names. */
function refsOf(note: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const take = (value: unknown) => {
    if (typeof value === "string" && isAttachmentRef(value)) refs.push(value);
  };
  if (Array.isArray(note.images)) note.images.forEach(take);
  if (Array.isArray(note.linkPreviews)) {
    for (const preview of note.linkPreviews) {
      if (!isRecord(preview)) continue;
      take(preview.image);
      take(preview.favicon);
    }
  }
  return refs;
}

/** `note` naming `owned` in place of each reference it was claimed for. */
function withOwned(
  note: Record<string, unknown>,
  owned: Map<string, string>,
): Record<string, unknown> {
  const own = (value: unknown) =>
    typeof value === "string" ? (owned.get(value) ?? value) : value;
  return {
    ...note,
    ...(Array.isArray(note.images) && { images: note.images.map(own) }),
    ...(Array.isArray(note.linkPreviews) && {
      linkPreviews: note.linkPreviews.map((preview: unknown) =>
        isRecord(preview)
          ? {
              ...preview,
              ...("image" in preview && { image: own(preview.image) }),
              ...("favicon" in preview && { favicon: own(preview.favicon) }),
            }
          : preview,
      ),
    }),
  };
}

/** `send`, sealing what a session sends and opening what it is answered. */
export function sealingClient(send: Fetch): Fetch {
  /**
   * Makes the images a note is about to name its owner's, as the app does
   * before it seals the note. A refusal is the answer to the whole write.
   */
  async function claimed(
    init: RequestInit,
    note: Record<string, unknown>,
    noteId: string | undefined,
  ): Promise<Record<string, unknown> | Response> {
    const refs = [...new Set(refsOf(note))];
    if (refs.length === 0 || "key" in note) return note;
    const res = await send("/api/attachments/claim", {
      method: "POST",
      headers: init.headers ?? {},
      body: JSON.stringify({ ...(noteId !== undefined && { noteId }), refs }),
    });
    if (!res.ok) return res;
    const answer = (await res.json()) as { refs: string[] };
    return withOwned(
      note,
      new Map(refs.map((ref, i) => [ref, answer.refs[i] ?? ref])),
    );
  }

  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (TOKEN.test(headers.get("Authorization") ?? "")) {
      return send(input, init);
    }
    const path = new URL(input, "http://test").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    let next = init;
    if (method === "POST" && path === "/api/attachments" && init) {
      next = sealedUpload(init) ?? init;
    }
    const accepted = /^\/api\/invitations\/([^/]+)\/accept$/.exec(path);
    if (
      method === "POST" &&
      accepted &&
      (init?.body == null || init.body === "{}")
    ) {
      // The app opens the key it was offered and sends it back wrapped
      // under its own notes key; here, a value of that shape.
      const list = await send("/api/invitations", {
        headers: init?.headers ?? {},
      });
      const invitations = list.ok
        ? ((await list.json()) as { invitations: ShareInvitation[] })
            .invitations
        : [];
      const keyVersion =
        invitations.find((i) => i.noteId === accepted[1])?.keyVersion ?? 1;
      const withJson = new Headers(init?.headers);
      withJson.set("Content-Type", "application/json");
      next = {
        ...init,
        headers: withJson,
        body: JSON.stringify({ key: ct("held key"), keyVersion }),
      };
    }
    if (typeof init?.body === "string") {
      try {
        let parsed: unknown = JSON.parse(init.body);
        const noteId = /^\/api\/notes\/([^/]+)$/.exec(path)?.[1];
        const writesNote =
          (method === "POST" && path === "/api/notes") ||
          (method === "PUT" && noteId !== undefined);
        if (writesNote && isRecord(parsed)) {
          const owned = await claimed(init, parsed, noteId);
          if (owned instanceof Response) return owned;
          parsed = owned;
        }
        const body = sealedBody(method, path, parsed);
        if (body !== null) next = { ...init, body: JSON.stringify(body) };
      } catch {
        // Not JSON: sent as it is, for the server to refuse.
      }
    }
    const res = await send(input, next);
    if (method === "GET" && res.ok && ATTACHMENT.test(path)) {
      return openedImage(res);
    }
    if (!res.headers.get("Content-Type")?.includes("application/json")) {
      return res;
    }
    const text = await res.text();
    let answer = text;
    try {
      answer = JSON.stringify(openedAnswer(JSON.parse(text), path));
    } catch {
      // Left as it came.
    }
    return new Response(answer, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
}
