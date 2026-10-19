import { derivable, type Note, NoteLimitError } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "#/storage/index.ts";
import { dropAllOffline } from "#/storage/offlineNotes.ts";
import { ImageUploadError, RequestError } from "#/storage/RestApiAdapter.ts";
import {
  LockedError,
  type StorageKeys,
  storageKeys,
} from "#/storage/sealing.ts";
import { notes } from "./notesStore.ts";
import {
  discardUnsent,
  queueNote,
  sendFailure,
  sendUnsent,
  settledNoteIds,
  unsentNotes,
} from "./unsentNotes.ts";

/**
 * The queue of new notes against a server that keeps what it is sent, with
 * the connection cut and restored under it. Sealing is handed through here
 * (`test/plainSealing.ts`), so the server reads readable notes; what is kept
 * on the device is sealed for real, under keys made for each test.
 */

const SERVER = "http://server.test";

type Fetch = typeof fetch;

/** Stores each note under the id it is sent with, as the real server does. */
class NoteServer {
  readonly notes = new Map<string, Note>();
  readonly requests: string[] = [];

  readonly fetch: Fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    this.requests.push(`${method} ${url.pathname}`);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.pathname === "/api/v1/notes" && method === "POST") {
      const sent = JSON.parse(String(init.body)) as Note;
      if (this.notes.has(sent.id)) return json({ error: "taken" }, 409);
      const now = new Date().toISOString();
      const note: Note = {
        ...sent,
        trashedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.notes.set(note.id, note);
      return json({ note }, 201);
    }
    const one = /^\/api\/v1\/notes\/([^/]+)$/.exec(url.pathname);
    if (one && method === "GET") {
      const note = this.notes.get(one[1] ?? "");
      return note ? json({ note }) : json({ error: "Not found" }, 404);
    }
    return json({ error: "Not here" }, 404);
  };

  posts(): number {
    return this.requests.filter((r) => r === "POST /api/v1/notes").length;
  }
}

let server: NoteServer;
let reach: Fetch;
let keys: StorageKeys;
const unreachable: Fetch = () => Promise.reject(new TypeError("offline"));

async function newKeys(): Promise<StorageKeys> {
  return {
    userId: `u-${crypto.randomUUID()}`,
    version: 1,
    accountKey: await derivable(crypto.getRandomValues(new Uint8Array(32))),
  };
}

/** The same account unlocked again, as after a reload. */
async function unlockAgain(): Promise<void> {
  storageKeys.value = { ...keys };
  await vi.waitFor(() => expect(unsentNotes.value.length).toBeGreaterThan(0));
}

beforeEach(async () => {
  server = new NoteServer();
  reach = server.fetch;
  vi.stubGlobal("fetch", ((input, init) => reach(input, init)) as Fetch);
  notes.value = [];
  storageConnection.value = { serverUrl: SERVER, token: "tok" };
  // An account of its own for each test: test files share one IndexedDB.
  keys = await newKeys();
  storageKeys.value = keys;
  await sendUnsent();
});

afterEach(async () => {
  await dropAllOffline(keys.userId);
  storageKeys.value = null;
  storageConnection.value = { serverUrl: null, token: null };
  notes.value = [];
  vi.unstubAllGlobals();
});

describe("queueNote", () => {
  it("sends a note at once, never showing it as waiting", async () => {
    expect(await queueNote({ title: "Milk" })).toBe(true);
    await sendUnsent();

    expect(notes.value.map((n) => n.title)).toEqual(["Milk"]);
    expect(unsentNotes.value).toEqual([]);
    expect(settledNoteIds.value.size).toBe(0);
    expect(server.notes.size).toBe(1);
  });

  it("keeps a note while the server is out of reach, and sends it after", async () => {
    reach = unreachable;
    await queueNote({ title: "Written on the train" });
    await sendUnsent();

    const [waiting] = unsentNotes.value;
    expect(waiting?.note.title).toBe("Written on the train");
    expect(waiting?.refused).toBe(false);
    expect(settledNoteIds.value.has(waiting?.id ?? "")).toBe(true);
    expect(notes.value).toEqual([]);

    reach = server.fetch;
    await sendUnsent();
    expect(unsentNotes.value).toEqual([]);
    expect(notes.value.map((n) => n.title)).toEqual(["Written on the train"]);
    // Under the id it was queued with.
    expect(server.notes.has(waiting?.id ?? "")).toBe(true);
  });

  it("keeps a waiting note across a reload, and sends it once back", async () => {
    reach = unreachable;
    await queueNote({ title: "Before the battery died" });
    await sendUnsent();

    await unlockAgain();
    expect(unsentNotes.value.map((e) => e.note.title)).toEqual([
      "Before the battery died",
    ]);

    reach = server.fetch;
    await sendUnsent();
    expect(unsentNotes.value).toEqual([]);
    expect([...server.notes.values()].map((n) => n.title)).toEqual([
      "Before the battery died",
    ]);
  });

  it("sends the notes in the order they were written", async () => {
    reach = unreachable;
    await queueNote({ title: "First" });
    await queueNote({ title: "Second" });
    await sendUnsent();
    expect(unsentNotes.value.map((e) => e.note.title)).toEqual([
      "First",
      "Second",
    ]);

    reach = server.fetch;
    await sendUnsent();
    expect([...server.notes.values()].map((n) => n.title)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("does not make a note twice when the answer to it was lost", async () => {
    reach = async (input, init) => {
      const res = await server.fetch(input, init);
      if (String(input).endsWith("/api/v1/notes") && init?.method === "POST") {
        throw new TypeError("the answer never came");
      }
      return res;
    };
    await queueNote({ title: "Arrived, unanswered" });
    await sendUnsent();
    expect(server.notes.size).toBe(1);
    expect(unsentNotes.value).toHaveLength(1);

    reach = server.fetch;
    await sendUnsent();
    expect(server.notes.size).toBe(1);
    expect(unsentNotes.value).toEqual([]);
    expect(notes.value.map((n) => n.title)).toEqual(["Arrived, unanswered"]);
  });

  it("keeps a note the server refuses, and does not send it again", async () => {
    reach = async (input, init) =>
      String(input).endsWith("/api/v1/notes") && init?.method === "POST"
        ? new Response(JSON.stringify({ error: "nope" }), { status: 422 })
        : server.fetch(input, init);
    await queueNote({ title: "Too much" });
    await sendUnsent();
    expect(unsentNotes.value[0]?.refused).toBe(true);
    const tries = server.posts();

    await sendUnsent();
    expect(unsentNotes.value).toHaveLength(1);
    expect(server.posts()).toBe(tries);
  });

  it("forgets a discarded note, here and on the device", async () => {
    reach = unreachable;
    await queueNote({ title: "Never mind" });
    await sendUnsent();
    const [waiting] = unsentNotes.value;
    expect(await discardUnsent(waiting?.id ?? "")).toBe(true);
    expect(unsentNotes.value).toEqual([]);

    storageKeys.value = { ...keys };
    await sendUnsent();
    expect(unsentNotes.value).toEqual([]);
  });

  it("lets go of the queue when the session ends", async () => {
    reach = unreachable;
    await queueNote({ title: "Mine" });
    await sendUnsent();
    expect(unsentNotes.value).toHaveLength(1);

    storageConnection.value = { serverUrl: SERVER, token: null };
    await vi.waitFor(() => expect(unsentNotes.value).toEqual([]));
  });
});

describe("sendFailure", () => {
  it("waits for a server it could not reach, or that is not taking notes", () => {
    expect(sendFailure(new TypeError("Failed to fetch"))).toBe("later");
    expect(sendFailure(new RequestError(503, "down"))).toBe("later");
    expect(sendFailure(new RequestError(429, "slow down"))).toBe("later");
    expect(sendFailure(new RequestError(401, "signed out"))).toBe("later");
    expect(sendFailure(new ImageUploadError(0))).toBe("later");
    expect(sendFailure(new LockedError())).toBe("later");
  });

  it("looks for the note when its id is taken", () => {
    expect(sendFailure(new RequestError(409, "taken"))).toBe("taken");
  });

  it("gives up on what will never be taken as it is", () => {
    expect(sendFailure(new RequestError(422, "bad"))).toBe("refused");
    expect(sendFailure(new RequestError(413, "too big"))).toBe("refused");
    expect(sendFailure(new ImageUploadError(415))).toBe("refused");
    expect(sendFailure(new NoteLimitError("title"))).toBe("refused");
  });
});
