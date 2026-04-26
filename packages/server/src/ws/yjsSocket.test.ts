import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import { createApp } from "../app.js";
import { type DB, openDatabase } from "../db/index.js";
import { TEST_CONFIG } from "../test/setup.js";
import { attachAppSocket, SUBPROTOCOL } from "./appSocket.js";
import { attachYjsSocket, type YjsSocket } from "./yjsSocket.js";

interface Rig {
  db: DB;
  server: ReturnType<typeof serve>;
  yjs: YjsSocket;
  baseUrl: string;
  wsBase: string;
}

const baseNote: NoteCreate = {
  title: "Yjs note",
  content: "initial content",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
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

async function bootRig(): Promise<Rig> {
  const db = openDatabase(":memory:");
  const cfg = { ...TEST_CONFIG, port: 0 };
  const result = createApp({ db, cfg });
  const ws = createNodeWebSocket({ app: result.app });
  attachAppSocket({
    app: result.app,
    ws,
    sessionsRepo: result.sessionsRepo,
    broadcaster: result.broadcaster,
    cfg,
  });
  // biome-ignore lint/suspicious/noExplicitAny: cast around hono-node-server's union return type
  const server = serve({ fetch: result.app.fetch, port: 0 }) as any;
  await new Promise<void>((resolve) => server.once("listening", resolve));
  ws.injectWebSocket(server);
  const yjs = attachYjsSocket({
    httpServer: server,
    db,
    sessionsRepo: result.sessionsRepo,
    notesRepo: result.notesRepo,
    cfg,
  });
  const port = (server.address() as AddressInfo).port;
  return {
    db,
    server,
    yjs,
    baseUrl: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
  };
}

async function close(rig: Rig): Promise<void> {
  await rig.yjs.destroy();
  await new Promise<void>((resolve) => rig.server.close(() => resolve()));
  rig.db.close();
}

async function register(
  rig: Rig,
  username: string,
): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${rig.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password-1234" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function createNote(
  rig: Rig,
  token: string,
  overrides: Partial<NoteCreate> = {},
): Promise<string> {
  const res = await fetch(`${rig.baseUrl}/api/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...baseNote, ...overrides }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { note: { id: string } };
  return body.note.id;
}

function rawWs(
  rig: Rig,
  noteId: string,
  token: string | null,
): { ws: WebSocket; closeCode: Promise<number> } {
  const protocols = token ? [SUBPROTOCOL, token] : [SUBPROTOCOL];
  const ws = new WebSocket(`${rig.wsBase}/api/yjs/notes/${noteId}`, protocols);
  const closeCode = new Promise<number>((resolve) => {
    ws.once("close", (code) => resolve(code));
    ws.once("error", () => resolve(-1));
  });
  return { ws, closeCode };
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once("open", () => resolve());
    ws.once("error", (e) => reject(e));
  });
}

async function readUnexpectedHttpStatus(ws: WebSocket): Promise<number | null> {
  return new Promise((resolve) => {
    ws.once("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? null);
      res.destroy();
    });
    ws.once("error", () => resolve(null));
    ws.once("open", () => resolve(null));
  });
}

describe("Yjs collaboration socket /api/yjs/notes/:id", () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await bootRig();
  });

  afterEach(async () => {
    await close(rig);
  });

  it("rejects connections without a token (HTTP 401)", async () => {
    const { token } = await register(rig, "alice");
    const noteId = await createNote(rig, token);
    const { ws } = rawWs(rig, noteId, null);
    const status = await readUnexpectedHttpStatus(ws);
    expect(status).toBe(401);
  });

  it("rejects connections with a bogus token (HTTP 401)", async () => {
    const { token } = await register(rig, "alice");
    const noteId = await createNote(rig, token);
    const { ws } = rawWs(rig, noteId, "deadbeef");
    const status = await readUnexpectedHttpStatus(ws);
    expect(status).toBe(401);
  });

  it("rejects access to another user's note (HTTP 403)", async () => {
    const { token: aliceToken } = await register(rig, "alice");
    const noteId = await createNote(rig, aliceToken);
    const { token: bobToken } = await register(rig, "bob");
    const { ws } = rawWs(rig, noteId, bobToken);
    const status = await readUnexpectedHttpStatus(ws);
    expect(status).toBe(403);
  });

  it("upgrades successfully for the note's owner", async () => {
    const { token } = await register(rig, "alice");
    const noteId = await createNote(rig, token);
    const { ws } = rawWs(rig, noteId, token);
    await waitOpen(ws);
    expect(ws.protocol).toBe(SUBPROTOCOL);
    ws.close();
  });

  it("persists Y.Doc updates to SQLite via the SqliteYjsStore extension", async () => {
    const { token, userId } = await register(rig, "alice");
    const noteId = await createNote(rig, token, { content: "" });

    const conn = await rig.yjs.hocuspocus.openDirectConnection(noteId, {
      userId,
      noteId,
    });
    await conn.transact((doc) => {
      doc.getText("scratch").insert(0, "Hello, world.");
    });
    await rig.yjs.hocuspocus.flushPendingStores();
    await conn.disconnect();

    const row = rig.db
      .prepare(`SELECT yjs_state FROM notes WHERE id = ? AND user_id = ?`)
      .get(noteId, userId) as { yjs_state: Buffer | null } | undefined;
    expect(row?.yjs_state).toBeInstanceOf(Buffer);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, new Uint8Array(row?.yjs_state ?? Buffer.alloc(0)));
    expect(restored.getText("scratch").toString()).toBe("Hello, world.");
  });

  it("rehydrates a Y.Doc from previously persisted state", async () => {
    const { token, userId } = await register(rig, "alice");
    const noteId = await createNote(rig, token, { content: "" });

    const first = await rig.yjs.hocuspocus.openDirectConnection(noteId, {
      userId,
      noteId,
    });
    await first.transact((doc) => {
      doc.getText("scratch").insert(0, "persisted bytes");
    });
    await rig.yjs.hocuspocus.flushPendingStores();
    await first.disconnect();

    // Force the document out of Hocuspocus's in-memory cache so the next
    // openDirectConnection reads from SQLite via SqliteYjsStore.onLoadDocument.
    rig.yjs.hocuspocus.closeConnections(noteId);

    const second = await rig.yjs.hocuspocus.openDirectConnection(noteId, {
      userId,
      noteId,
    });
    let observed = "";
    await second.transact((doc) => {
      observed = doc.getText("scratch").toString();
    });
    await second.disconnect();
    expect(observed).toBe("persisted bytes");
  });
});
