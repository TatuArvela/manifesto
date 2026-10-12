import {
  CIPHERTEXT_PREFIX,
  type NoteCreate,
  type NoteUpdate,
  type SealedNote,
  type SealedNoteVersion,
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

/** `send`, sealing what a session sends and opening what it is answered. */
export function sealingClient(send: Fetch): Fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (TOKEN.test(headers.get("Authorization") ?? "")) {
      return send(input, init);
    }
    const path = new URL(input, "http://test").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    let next = init;
    if (typeof init?.body === "string") {
      try {
        const body = sealedBody(method, path, JSON.parse(init.body));
        if (body !== null) next = { ...init, body: JSON.stringify(body) };
      } catch {
        // Not JSON: sent as it is, for the server to refuse.
      }
    }
    const res = await send(input, next);
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
