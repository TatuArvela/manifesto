import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Note,
  WebhookCreatedResponse,
  WebhookPayload,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "#/app.ts";
import { createAuthProvider } from "#/auth/index.ts";
import { createStorage } from "#/storage/index.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { keyedToken } from "#/test/keyedTokens.ts";
import { authHeaders, TEST_CONFIG } from "#/test/setup.ts";
import { signDelivery, type WebhookDispatcher } from "./dispatcher.ts";

/**
 * `docs/examples/webhooks/receiver.mjs` is documentation that people copy.
 * Thus, the test compares it with the server that it documents. Real deliveries
 * from the real dispatcher must pass its signature check and run its recipes.
 * The note that a delivery names must be readable with a real API token,
 * because a delivery contains none of its words.
 */

/** The server address that the recipes get. */
const MANIFESTO_URL = "https://notes.example";

type Recipe = (
  delivery: WebhookPayload,
  env?: Record<string, string | undefined>,
) => Promise<void>;

interface Example {
  isAuthentic(
    secret: string,
    timestamp: string | undefined,
    body: string,
    signature: string | undefined,
    now?: number,
  ): boolean;
  createReceiver(options: { secret: string; recipes: Recipe[] }): Server;
  todoTagOpensIssue: Recipe;
  notifyTagPushes: Recipe;
  mirrorToFolder: Recipe;
}

const examplePath = resolve(
  import.meta.dirname,
  "../../../../docs/examples/webhooks/receiver.mjs",
);
const loadExample = async () =>
  (await import(pathToFileURL(examplePath).href)) as Example;

/** Starts `server` on a free loopback port, and tells which. */
const listen = (server: Server) =>
  new Promise<number>((done) => {
    server.listen(0, "127.0.0.1", () =>
      done((server.address() as AddressInfo).port),
    );
  });
const close = (server: Server) => new Promise((done) => server.close(done));

const baseNote = {
  title: "Hello",
  content: "Body text",
  color: NoteColor.Default,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: ["home"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

describe("the example webhook receiver", () => {
  it("accepts what the server signs, and nothing else", async () => {
    const { isAuthentic } = await loadExample();
    const now = Date.parse("2026-10-03T12:00:00Z");
    const timestamp = String(now / 1000);
    const body = '{"event":"note.created"}';
    const signature = signDelivery("whsec_test", timestamp, body);

    expect(isAuthentic("whsec_test", timestamp, body, signature, now)).toBe(
      true,
    );
    expect(isAuthentic("whsec_other", timestamp, body, signature, now)).toBe(
      false,
    );
    expect(
      isAuthentic("whsec_test", timestamp, `${body} `, signature, now),
    ).toBe(false);
    expect(isAuthentic("whsec_test", timestamp, body, undefined, now)).toBe(
      false,
    );
    // The same delivery, sent again ten minutes later.
    expect(
      isAuthentic("whsec_test", timestamp, body, signature, now + 600_000),
    ).toBe(false);
  });

  describe("fed by the real dispatcher", () => {
    let storage: StorageDriver;
    let request: (path: string, init?: RequestInit) => Promise<Response>;
    let dispatcher: WebhookDispatcher;
    let receiver: Server | null = null;
    let mirror: string;
    const realFetch = globalThis.fetch;

    beforeEach(async () => {
      mirror = await mkdtemp(join(tmpdir(), "manifesto-mirror-"));
      const cfg = { ...TEST_CONFIG, webhooks: "public" as const };
      storage = await createStorage(cfg);
      const handle = createApp({
        cfg,
        storage,
        authProvider: createAuthProvider(cfg, storage),
        webhookAddressPolicy: (address) => address === "127.0.0.1",
        webhookRetryDelaysMs: [0, 1],
      });
      dispatcher = handle.webhooks as WebhookDispatcher;
      request = async (path, init) => handle.app.request(path, init);
      // The app under test listens nowhere. The code gives it what a recipe
      // asks of the address of the server. All other requests go out as usual.
      vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) =>
        String(url).startsWith(MANIFESTO_URL)
          ? request(String(url).slice(MANIFESTO_URL.length), init)
          : realFetch(url, init),
      );
    });

    afterEach(async () => {
      await dispatcher.idle();
      dispatcher.stop();
      if (receiver) await close(receiver);
      receiver = null;
      await storage.close();
      await rm(mirror, { recursive: true, force: true });
      vi.unstubAllGlobals();
    });

    it("mirrors notes to a folder as they are made, changed and deleted", async () => {
      const example = await loadExample();
      const registered = await request("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "test-pass-12" }),
      });
      const { token: session, user } = (await registered.json()) as {
        token: string;
        user: { id: string };
      };
      const as =
        (bearer: string) => (method: string, path: string, body?: unknown) =>
          request(path, {
            method,
            headers: authHeaders(bearer),
            ...(body !== undefined && { body: JSON.stringify(body) }),
          });
      const call = as(session);
      // The token with which the receiver reads notes, made as the app makes
      // one: it contains the keys. The notes are also written with it. Thus,
      // they are sealed under keys that it opens.
      const made = await keyedToken(user.id, "api");
      const minted = await call("POST", "/api/v1/tokens", {
        name: "Receiver",
        password: "test-pass-12",
        ...made.fields,
      });
      expect(minted.status).toBe(201);
      const script = as(made.secret);
      const env = {
        MIRROR_DIR: mirror,
        MANIFESTO_URL,
        MANIFESTO_TOKEN: made.secret,
      };

      // The address of the webhook must exist before its secret does, and the
      // receiver needs the secret. Thus, the listening server comes first. It
      // gives its requests to a receiver made after the secret is known.
      let inner: Server | null = null;
      const front = createServer((req, res) => {
        inner?.emit("request", req, res);
      });
      receiver = front;
      const port = await listen(front);
      const added = await call("POST", "/api/v1/webhooks", {
        url: `http://127.0.0.1:${port}/hook`,
        password: "test-pass-12",
      });
      expect(added.status).toBe(201);
      const { secret } = (await added.json()) as WebhookCreatedResponse;

      const deliveries: string[] = [];
      inner = example.createReceiver({
        secret,
        recipes: [
          async (delivery) => {
            deliveries.push(delivery.event);
            // Nothing of the note's words is in what was delivered.
            expect(JSON.stringify(delivery)).not.toContain("Hello");
            await example.mirrorToFolder(delivery, env);
          },
        ],
      });

      const created = await script("POST", "/api/v1/notes", baseNote);
      expect(created.status).toBe(201);
      const note = ((await created.json()) as { note: Note }).note;
      await dispatcher.idle();
      await vi.waitFor(async () =>
        expect(await readdir(mirror)).toEqual([`${note.id}.md`]),
      );
      const written = await readFile(join(mirror, `${note.id}.md`), "utf8");
      expect(written).toContain('title: "Hello"');
      expect(written).toContain('tags: ["home"]');
      expect(written).toContain("Body text");

      await script("PUT", `/api/v1/notes/${note.id}`, { title: "Renamed" });
      await dispatcher.idle();
      await vi.waitFor(async () =>
        expect(await readFile(join(mirror, `${note.id}.md`), "utf8")).toContain(
          'title: "Renamed"',
        ),
      );

      await script("DELETE", `/api/v1/notes/${note.id}`);
      await dispatcher.idle();
      await vi.waitFor(async () => expect(await readdir(mirror)).toEqual([]));
      expect(deliveries).toEqual([
        "note.created",
        "note.updated",
        "note.deleted",
      ]);

      // The server's own verdict on the receiver: every delivery got a 2xx.
      const listed = (await (await call("GET", "/api/v1/webhooks")).json()) as {
        webhooks: { lastStatus: number | null; failureCount: number }[];
      };
      expect(listed.webhooks[0]).toMatchObject({
        lastStatus: 204,
        failureCount: 0,
      });
    });
  });

  describe("on its own", () => {
    const SECRET = "whsec_test";
    let receiver: Server | null = null;

    afterEach(async () => {
      if (receiver) await close(receiver);
      receiver = null;
    });

    async function start(recipes: Recipe[]) {
      const example = await loadExample();
      receiver = example.createReceiver({ secret: SECRET, recipes });
      return listen(receiver);
    }

    function send(port: number, deliveryId: string, event = "note.deleted") {
      const body = JSON.stringify({
        event,
        deliveryId,
        occurredAt: "2026-10-03T12:00:00.000Z",
        noteId: "01NOTE",
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      return fetch(`http://127.0.0.1:${port}/hook`, {
        method: "POST",
        body,
        headers: {
          "X-Manifesto-Event": event,
          "X-Manifesto-Delivery": deliveryId,
          "X-Manifesto-Timestamp": timestamp,
          "X-Manifesto-Signature": signDelivery(SECRET, timestamp, body),
        },
      });
    }

    it("works through deliveries in the order they came, however slow a recipe is", async () => {
      const finished: string[] = [];
      const port = await start([
        async (delivery) => {
          // The first is the slow one: answered at once, it is still being
          // worked on when the second arrives.
          if (delivery.deliveryId === "first") {
            await new Promise((r) => setTimeout(r, 50));
          }
          finished.push(delivery.deliveryId);
        },
      ]);
      expect((await send(port, "first")).status).toBe(204);
      expect((await send(port, "second")).status).toBe(204);
      await vi.waitFor(() => expect(finished).toEqual(["first", "second"]));
    });

    it("drops a delivery it has seen, and a ping", async () => {
      const handled: string[] = [];
      const port = await start([
        async (delivery) => {
          handled.push(delivery.deliveryId);
        },
      ]);
      await send(port, "once");
      await send(port, "once");
      expect((await send(port, "hello", "ping")).status).toBe(204);
      await send(port, "last");
      await vi.waitFor(() => expect(handled).toEqual(["once", "last"]));
    });

    it("outlives a sender that hangs up partway through the body", async () => {
      const port = await start([]);
      await new Promise<void>((done) => {
        const socket = connect(port, "127.0.0.1", () => {
          socket.write(
            "POST /hook HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\nabc",
          );
          setTimeout(() => socket.destroy(), 20);
        });
        socket.on("close", () => done());
      });
      // An unhandled rejection in the handler would end the process; a
      // receiver that is still there turns the next unsigned request away.
      await new Promise((r) => setTimeout(r, 50));
      const res = await fetch(`http://127.0.0.1:${port}/hook`, {
        method: "POST",
        body: "{}",
      });
      expect(res.status).toBe(401);
    });
  });

  /** The notes the stubbed server answers a recipe's read with, by id. */
  const served = new Map<string, Note>();

  /**
   * A delivery about a note, which the server is then asked for: the
   * delivery carries the fields the server reads, the answer the rest.
   */
  const noteDelivery = (
    id: string,
    tags: string[],
    fields: Partial<Note> = {},
  ): WebhookPayload => {
    const note: Note = {
      ...baseNote,
      id,
      title: "Fix the gate",
      tags,
      createdAt: "",
      updatedAt: "",
      ...fields,
    };
    served.set(id, note);
    return {
      event: "note.updated",
      deliveryId: "d1",
      occurredAt: "2026-10-03T12:00:00.000Z",
      note: {
        id,
        pinned: note.pinned,
        archived: note.archived,
        trashed: note.trashed,
        trashedAt: note.trashedAt,
        position: note.position,
        reminder: note.reminder,
        createdAt: "",
        updatedAt: "",
      },
    };
  };

  /** The server's answer to a recipe reading a note, or null for any other
   * address. */
  const noteRead = (url: string, init?: RequestInit): Response | null => {
    if (!url.startsWith(`${MANIFESTO_URL}/api/v1/notes/`)) return null;
    const bearer = new Headers(init?.headers).get("Authorization");
    if (bearer !== "Bearer mfp_test")
      return new Response(null, { status: 401 });
    const note = served.get(url.slice(`${MANIFESTO_URL}/api/v1/notes/`.length));
    return note
      ? new Response(JSON.stringify({ note }))
      : new Response(null, { status: 404 });
  };
  const reading = { MANIFESTO_URL, MANIFESTO_TOKEN: "mfp_test" };

  describe("the todo recipe", () => {
    const env = { GITHUB_REPO: "me/chores", GITHUB_TOKEN: "t", ...reading };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** `indexed` is whether GitHub's search already finds the note's issue. */
    function stubGitHub(indexed: boolean) {
      const calls: { url: string; method: string; body: unknown }[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        const read = noteRead(url, init);
        if (read) return read;
        calls.push({
          url,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify({ total_count: indexed ? 1 : 0 }), {
          status: init?.method === "POST" ? 201 : 200,
        });
      });
      return calls;
    }

    it("opens one issue for a note tagged todo, naming the note in it", async () => {
      const { todoTagOpensIssue } = await loadExample();
      const calls = stubGitHub(false);
      await todoTagOpensIssue(noteDelivery("01OPENS", ["todo"]), env);
      expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
      expect(calls[1]?.url).toBe(
        "https://api.github.com/repos/me/chores/issues",
      );
      expect(calls[1]?.body).toMatchObject({ title: "Fix the gate" });
      expect(JSON.stringify(calls[1]?.body)).toContain(
        "manifesto-note:01OPENS",
      );
    });

    it("leaves a note alone that has its issue, or no todo tag", async () => {
      const { todoTagOpensIssue } = await loadExample();
      const calls = stubGitHub(true);
      await todoTagOpensIssue(noteDelivery("01HASONE", ["todo"]), env);
      expect(calls.map((c) => c.method)).toEqual(["GET"]);
      calls.length = 0;
      await todoTagOpensIssue(noteDelivery("01UNTAGGED", ["home"]), env);
      expect(calls).toEqual([]);
    });

    it("opens no second issue while GitHub's search has yet to find the first", async () => {
      const { todoTagOpensIssue } = await loadExample();
      const calls = stubGitHub(false);
      await todoTagOpensIssue(noteDelivery("01TYPING", ["todo"]), env);
      await todoTagOpensIssue(noteDelivery("01TYPING", ["todo"]), env);
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    });

    it("cuts a title GitHub would refuse for its length", async () => {
      const { todoTagOpensIssue } = await loadExample();
      const calls = stubGitHub(false);
      await todoTagOpensIssue(
        noteDelivery("01LONG", ["todo"], { title: "x".repeat(500) }),
        env,
      );
      expect(calls[1]?.body).toMatchObject({ title: "x".repeat(256) });
    });
  });

  describe("the notify recipe", () => {
    const env = { NTFY_URL: "https://ntfy.example/topic", ...reading };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("pushes the title of a note tagged notify, and nothing of its text", async () => {
      const { notifyTagPushes } = await loadExample();
      const calls: { url: string; init: RequestInit | undefined }[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        const read = noteRead(url, init);
        if (read) return read;
        calls.push({ url, init });
        return new Response(null, { status: 200 });
      });
      await notifyTagPushes(noteDelivery("01PUSH", ["notify"]), env);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://ntfy.example/topic");
      expect(calls[0]?.init).toMatchObject({
        method: "POST",
        body: "Fix the gate",
      });

      // Without a token there is no note to read, and nothing is pushed.
      calls.length = 0;
      await notifyTagPushes(noteDelivery("01NOTOKEN", ["notify"]), {
        NTFY_URL: env.NTFY_URL,
      });
      await notifyTagPushes(noteDelivery("01QUIET", ["home"]), env);
      await notifyTagPushes(
        noteDelivery("01BINNED", ["notify"], { trashed: true }),
        env,
      );
      expect(calls).toEqual([]);
    });
  });
});
