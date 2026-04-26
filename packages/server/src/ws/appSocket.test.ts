import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Note } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../app.js";
import { type DB, openDatabase } from "../db/index.js";
import { TEST_CONFIG } from "../test/setup.js";
import { attachAppSocket, SUBPROTOCOL } from "./appSocket.js";

interface Rig {
  db: DB;
  server: ReturnType<typeof serve>;
  baseUrl: string;
  wsUrl: string;
}

async function bootRig(): Promise<Rig> {
  const db = openDatabase(":memory:");
  const cfg = { ...TEST_CONFIG, port: 0 };
  const { app, sessionsRepo, broadcaster } = createApp({ db, cfg });
  const ws = createNodeWebSocket({ app });
  attachAppSocket({ app, ws, sessionsRepo, broadcaster, cfg });
  const server = serve({ fetch: app.fetch, port: 0 });
  ws.injectWebSocket(server);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const port = (server.address() as AddressInfo).port;
  return {
    db,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/api/ws`,
  };
}

async function close(rig: Rig): Promise<void> {
  await new Promise<void>((resolve) => {
    rig.server.close(() => resolve());
  });
  rig.db.close();
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

  it("emits presence:join when the client sends presence:update", async () => {
    const token = await register(rig, "alice");
    // tab A, will receive the broadcast
    const a = openSocket(rig.wsUrl, token);
    // tab B, will originate the presence change
    const b = openSocket(rig.wsUrl, token);
    await Promise.all([waitOpen(a.ws), waitOpen(b.ws)]);

    const aReceived = new Promise<string>((resolve) => {
      a.ws.once("message", (data) => resolve(data.toString()));
    });

    b.ws.send(JSON.stringify({ type: "presence:update", noteId: "note-X" }));
    const raw = await aReceived;
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("presence:join");
    expect(parsed.noteId).toBe("note-X");

    a.ws.close();
    b.ws.close();
  });
});
