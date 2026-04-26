import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Note } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import { createStorage } from "../storage/index.js";
import type { StorageDriver } from "../storage/types.js";
import { TEST_CONFIG } from "../test/setup.js";
import { attachAppSocket, SUBPROTOCOL } from "./appSocket.js";

interface Rig {
  storage: StorageDriver;
  server: ReturnType<typeof serve>;
  baseUrl: string;
  wsUrl: string;
}

async function bootRig(): Promise<Rig> {
  const cfg = { ...TEST_CONFIG, port: 0 };
  const storage = await createStorage(cfg);
  const authProvider = createAuthProvider(cfg, storage);
  const { app, broadcaster } = createApp({ cfg, storage, authProvider });
  const ws = createNodeWebSocket({ app });
  attachAppSocket({ app, ws, authProvider, broadcaster, cfg });
  const server = serve({ fetch: app.fetch, port: 0 });
  ws.injectWebSocket(server);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const port = (server.address() as AddressInfo).port;
  return {
    storage,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/api/ws`,
  };
}

async function close(rig: Rig): Promise<void> {
  await new Promise<void>((resolve) => {
    rig.server.close(() => resolve());
  });
  await rig.storage.close();
}

async function register(rig: Rig, username: string): Promise<string> {
  const res = await fetch(`${rig.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password-1234" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function openSocket(
  url: string,
  token: string | null,
): { ws: WebSocket; messages: Promise<string[]>; resolve: () => void } {
  const subprotocols = token ? [SUBPROTOCOL, token] : [SUBPROTOCOL];
  const ws = new WebSocket(url, subprotocols);
  const buffer: string[] = [];
  let resolveFn: () => void = () => {};
  const settle = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  ws.on("message", (data) => buffer.push(data.toString()));
  ws.on("close", () => resolveFn());
  ws.on("error", () => resolveFn());
  return {
    ws,
    messages: settle.then(() => buffer),
    resolve: resolveFn,
  };
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once("open", () => resolve());
    ws.once("error", (e) => reject(e));
    ws.once("close", () => resolve());
  });
}

async function authedPost<T>(
  rig: Rig,
  path: string,
  token: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${rig.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as T;
}

const baseNote = {
  title: "WS",
  content: "hi",
  color: "yellow",
  font: "default",
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: [],
  images: [],
  linkPreviews: [],
  reminder: null,
};

describe("application WebSocket /api/ws", () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await bootRig();
  });

  afterEach(async () => {
    await close(rig);
  });

  it("rejects connections with no token (closes with 4401)", async () => {
    const { ws } = openSocket(rig.wsUrl, null);
    const closeCode = await new Promise<number>((resolve) => {
      ws.once("close", (code) => resolve(code));
    });
    expect(closeCode).toBe(4401);
  });

  it("rejects an invalid token (closes with 4401)", async () => {
    const { ws } = openSocket(rig.wsUrl, "bogus-token");
    const closeCode = await new Promise<number>((resolve) => {
      ws.once("close", (code) => resolve(code));
    });
    expect(closeCode).toBe(4401);
  });

  it("broadcasts note:created from a REST POST", async () => {
    const token = await register(rig, "alice");
    const { ws } = openSocket(rig.wsUrl, token);
    await waitOpen(ws);

    const received = new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(data.toString()));
    });

    await authedPost<{ note: Note }>(rig, "/api/notes", token, baseNote);

    const raw = await received;
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("note:created");
    expect(parsed.note.title).toBe("WS");

    ws.close();
  });

  it("isolates users — Bob's writes don't reach Alice's socket", async () => {
    const aliceToken = await register(rig, "alice");
    const bobToken = await register(rig, "bob");

    const aliceSock = openSocket(rig.wsUrl, aliceToken);
    await waitOpen(aliceSock.ws);

    let aliceGot: string | null = null;
    aliceSock.ws.on("message", (data) => {
      aliceGot = data.toString();
    });

    await authedPost<{ note: Note }>(rig, "/api/notes", bobToken, baseNote);

    // give the loop a chance to deliver any (unwanted) message
    await new Promise((r) => setTimeout(r, 100));

    expect(aliceGot).toBeNull();
    aliceSock.ws.close();
  });

  it("emits presence:join with the originating user's profile", async () => {
    const token = await register(rig, "alice");
    // tab A, will receive the broadcast
    const a = openSocket(rig.wsUrl, token);
    // tab B, will originate the presence change
    const b = openSocket(rig.wsUrl, token);
    await Promise.all([waitOpen(a.ws), waitOpen(b.ws)]);

    let bReceivedSelf = false;
    b.ws.on("message", () => {
      bReceivedSelf = true;
    });

    const aReceived = new Promise<string>((resolve) => {
      a.ws.once("message", (data) => resolve(data.toString()));
    });

    b.ws.send(JSON.stringify({ type: "presence:update", noteId: "note-X" }));
    const raw = await aReceived;
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("presence:join");
    expect(parsed.noteId).toBe("note-X");
    expect(parsed.user.displayName).toBe("alice");
    expect(typeof parsed.user.avatarColor).toBe("string");
    expect(parsed.user.id).toMatch(/^[0-9A-Z]{26}$/);

    // The originator should not see its own presence echoed back.
    await new Promise((r) => setTimeout(r, 50));
    expect(bReceivedSelf).toBe(false);

    a.ws.close();
    b.ws.close();
  });

  it("only emits one presence:join when the same user opens the note in multiple tabs", async () => {
    const token = await register(rig, "alice");
    const observer = openSocket(rig.wsUrl, token);
    const tabA = openSocket(rig.wsUrl, token);
    const tabB = openSocket(rig.wsUrl, token);
    await Promise.all([
      waitOpen(observer.ws),
      waitOpen(tabA.ws),
      waitOpen(tabB.ws),
    ]);

    const events: string[] = [];
    observer.ws.on("message", (data) => events.push(data.toString()));

    tabA.ws.send(JSON.stringify({ type: "presence:update", noteId: "note-Y" }));
    tabB.ws.send(JSON.stringify({ type: "presence:update", noteId: "note-Y" }));
    await new Promise((r) => setTimeout(r, 80));

    const joins = events
      .map((raw) => JSON.parse(raw))
      .filter((e) => e.type === "presence:join" && e.noteId === "note-Y");
    expect(joins).toHaveLength(1);

    observer.ws.close();
    tabA.ws.close();
    tabB.ws.close();
  });
});
