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
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import { createStorage } from "../storage/index.js";
import type { StorageDriver } from "../storage/types.js";
import { authHeaders, TEST_CONFIG } from "../test/setup.js";
import { signDelivery, type WebhookDispatcher } from "./dispatcher.js";

/**
 * `docs/examples/webhooks/receiver.mjs` is documentation people copy, so it
 * is held to the server it documents: real deliveries from the real
 * dispatcher have to pass its signature check and drive its recipes.
 */

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

/** Starts `server` on a free loopback port, and says which. */
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
    // The same delivery, replayed ten minutes later.
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
    });

    afterEach(async () => {
      await dispatcher.idle();
      dispatcher.stop();
      if (receiver) await close(receiver);
      receiver = null;
      await storage.close();
      await rm(mirror, { recursive: true, force: true });
    });

    it("mirrors notes to a folder as they are made, changed and deleted", async () => {
      const example = await loadExample();
      const registered = await request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "test-pass-12" }),
      });
      const { token } = (await registered.json()) as { token: string };
      const call = (method: string, path: string, body?: unknown) =>
        request(path, {
          method,
          headers: authHeaders(token),
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });

      // The webhook's address has to exist before its secret does, and the
      // receiver wants the secret: so the listening server comes first, and
      // hands its requests to a receiver made once the secret is known.
      let inner: Server | null = null;
      const front = createServer((req, res) => {
        inner?.emit("request", req, res);
      });
      receiver = front;
      const port = await listen(front);
      const added = await call("POST", "/api/webhooks", {
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
            await example.mirrorToFolder(delivery, { MIRROR_DIR: mirror });
          },
        ],
      });

      const created = await call("POST", "/api/notes", baseNote);
      const note = ((await created.json()) as { note: Note }).note;
      await dispatcher.idle();
      await vi.waitFor(async () =>
        expect(await readdir(mirror)).toEqual([`${note.id}.md`]),
      );
      const written = await readFile(join(mirror, `${note.id}.md`), "utf8");
      expect(written).toContain('title: "Hello"');
      expect(written).toContain('tags: ["home"]');
      expect(written).toContain("Body text");

      await call("PUT", `/api/notes/${note.id}`, { title: "Renamed" });
      await dispatcher.idle();
      await vi.waitFor(async () =>
        expect(await readFile(join(mirror, `${note.id}.md`), "utf8")).toContain(
          'title: "Renamed"',
        ),
      );

      await call("DELETE", `/api/notes/${note.id}`);
      await dispatcher.idle();
      await vi.waitFor(async () => expect(await readdir(mirror)).toEqual([]));
      expect(deliveries).toEqual([
        "note.created",
        "note.updated",
        "note.deleted",
      ]);

      // The server's own verdict on the receiver: every delivery got a 2xx.
      const listed = (await (await call("GET", "/api/webhooks")).json()) as {
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

  const noteDelivery = (
    id: string,
    tags: string[],
    fields: Partial<Note> = {},
  ): WebhookPayload => ({
    event: "note.updated",
    deliveryId: "d1",
    occurredAt: "2026-10-03T12:00:00.000Z",
    note: {
      ...baseNote,
      id,
      title: "Fix the gate",
      tags,
      createdAt: "",
      updatedAt: "",
      ...fields,
    },
  });

  describe("the todo recipe", () => {
    const env = { GITHUB_REPO: "me/chores", GITHUB_TOKEN: "t" };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** `indexed` is whether GitHub's search already finds the note's issue. */
    function stubGitHub(indexed: boolean) {
      const calls: { url: string; method: string; body: unknown }[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
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
    const env = { NTFY_URL: "https://ntfy.example/topic" };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("pushes the title of a note tagged notify, and nothing of its text", async () => {
      const { notifyTagPushes } = await loadExample();
      const calls: { url: string; init: RequestInit | undefined }[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
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

      calls.length = 0;
      await notifyTagPushes(noteDelivery("01QUIET", ["home"]), env);
      await notifyTagPushes(
        noteDelivery("01BINNED", ["notify"], { trashed: true }),
        env,
      );
      expect(calls).toEqual([]);
    });
  });
});
