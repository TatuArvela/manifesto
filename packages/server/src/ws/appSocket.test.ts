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
  stopHeartbeat: () => void;
}

async function bootRig(heartbeatMs?: number): Promise<Rig> {
  const cfg = { ...TEST_CONFIG, port: 0 };
  const storage = await createStorage(cfg);
  const authProvider = createAuthProvider(cfg, storage);
  const { app, broadcaster, revocations, accessChanges } = createApp({
    cfg,
    storage,
    authProvider,
  });
  const ws = createNodeWebSocket({ app });
  const stopHeartbeat = attachAppSocket({
    app,
    ws,
    authProvider,
    broadcaster,
    revocations,
    accessChanges,
    storage,
    cfg,
    heartbeatMs,
  });
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
    stopHeartbeat,
  };
}

async function close(rig: Rig): Promise<void> {
  rig.stopHeartbeat();
  await new Promise<void>((resolve) => {
    rig.server.close(() => resolve());
  });
  await rig.storage.close();
}

async function signIn(rig: Rig, username: string): Promise<string> {
  const res = await fetch(`${rig.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password-1234" }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
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

  it("isolates users: Bob's writes don't reach Alice's socket", async () => {
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
    const { note } = await authedPost<{ note: Note }>(
      rig,
      "/api/notes",
      token,
      baseNote,
    );
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

    b.ws.send(JSON.stringify({ type: "presence:update", noteId: note.id }));
    const raw = await aReceived;
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("presence:join");
    expect(parsed.noteId).toBe(note.id);
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
    const { note } = await authedPost<{ note: Note }>(
      rig,
      "/api/notes",
      token,
      baseNote,
    );
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

    tabA.ws.send(JSON.stringify({ type: "presence:update", noteId: note.id }));
    tabB.ws.send(JSON.stringify({ type: "presence:update", noteId: note.id }));
    await new Promise((r) => setTimeout(r, 80));

    const joins = events
      .map((raw) => JSON.parse(raw))
      .filter((e) => e.type === "presence:join" && e.noteId === note.id);
    expect(joins).toHaveLength(1);

    observer.ws.close();
    tabA.ws.close();
    tabB.ws.close();
  });

  it("closes the sockets of sessions a password change ends, and keeps its own", async () => {
    const elsewhere = await register(rig, "alice");
    const here = await signIn(rig, "alice");
    const other = openSocket(rig.wsUrl, elsewhere);
    const own = openSocket(rig.wsUrl, here);
    await Promise.all([waitOpen(other.ws), waitOpen(own.ws)]);
    // The server authenticates in its own open handler, after the client's.
    await new Promise((r) => setTimeout(r, 50));

    const otherClosed = new Promise<number>((resolve) => {
      other.ws.once("close", (code) => resolve(code));
    });
    const res = await fetch(`${rig.baseUrl}/api/auth/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${here}`,
      },
      body: JSON.stringify({
        currentPassword: "password-1234",
        newPassword: "password-5678",
      }),
    });
    expect(res.status).toBe(204);

    expect(await otherClosed).toBe(4401);
    await new Promise((r) => setTimeout(r, 50));
    expect(own.ws.readyState).toBe(WebSocket.OPEN);
    own.ws.close();
  });

  it("closes only the sockets a revoked API token opened", async () => {
    const session = await register(rig, "alice");
    const created = await fetch(`${rig.baseUrl}/api/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({ name: "script" }),
    });
    const { token, secret } = (await created.json()) as {
      token: { id: string };
      secret: string;
    };
    const script = openSocket(rig.wsUrl, secret);
    const browser = openSocket(rig.wsUrl, session);
    await Promise.all([waitOpen(script.ws), waitOpen(browser.ws)]);
    await new Promise((r) => setTimeout(r, 50));

    const scriptClosed = new Promise<number>((resolve) => {
      script.ws.once("close", (code) => resolve(code));
    });
    const res = await fetch(`${rig.baseUrl}/api/tokens/${token.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session}` },
    });
    expect(res.status).toBe(204);
    expect(await scriptClosed).toBe(4401);
    await new Promise((r) => setTimeout(r, 50));
    expect(browser.ws.readyState).toBe(WebSocket.OPEN);
    browser.ws.close();
  });

  async function registerWithId(
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

  function collect(ws: WebSocket): () => { type: string; noteId?: string }[] {
    const seen: string[] = [];
    ws.on("message", (data) => seen.push(data.toString()));
    return () => seen.map((raw) => JSON.parse(raw));
  }

  it("shows presence to the people a note is shared with, and nobody else", async () => {
    const owner = await registerWithId("olivia");
    const alice = await registerWithId("alice");
    const bob = await registerWithId("bob");
    const { note } = await authedPost<{ note: Note }>(
      rig,
      "/api/notes",
      owner.token,
      baseNote,
    );
    await authedPost(rig, `/api/notes/${note.id}/shares`, owner.token, {
      userId: alice.userId,
      role: "view",
    });
    await authedPost(
      rig,
      `/api/invitations/${note.id}/accept`,
      alice.token,
      {},
    );

    const ownerSock = openSocket(rig.wsUrl, owner.token);
    const aliceSock = openSocket(rig.wsUrl, alice.token);
    const bobSock = openSocket(rig.wsUrl, bob.token);
    await Promise.all([
      waitOpen(ownerSock.ws),
      waitOpen(aliceSock.ws),
      waitOpen(bobSock.ws),
    ]);
    await new Promise((r) => setTimeout(r, 50));
    const toAlice = collect(aliceSock.ws);
    const toBob = collect(bobSock.ws);
    const toOwner = collect(ownerSock.ws);

    ownerSock.ws.send(
      JSON.stringify({ type: "presence:update", noteId: note.id }),
    );
    // Bob has no business on this note, so his claim to be viewing it is
    // not passed on to anyone.
    bobSock.ws.send(
      JSON.stringify({ type: "presence:update", noteId: note.id }),
    );
    await new Promise((r) => setTimeout(r, 100));

    expect(toAlice()).toContainEqual(
      expect.objectContaining({ type: "presence:join", noteId: note.id }),
    );
    expect(toBob()).toEqual([]);
    expect(toOwner()).toEqual([]);

    // Someone arriving learns who is already there.
    aliceSock.ws.send(
      JSON.stringify({ type: "presence:update", noteId: note.id }),
    );
    await new Promise((r) => setTimeout(r, 100));
    const joinsForAlice = toAlice().filter((e) => e.type === "presence:join");
    expect(joinsForAlice).toHaveLength(2);
    expect(toOwner()).toContainEqual(
      expect.objectContaining({ type: "presence:join", noteId: note.id }),
    );

    ownerSock.ws.close();
    aliceSock.ws.close();
    bobSock.ws.close();
  });

  async function noteViewedByOwner() {
    const owner = await registerWithId("olivia");
    const alice = await registerWithId("alice");
    const { note } = await authedPost<{ note: Note }>(
      rig,
      "/api/notes",
      owner.token,
      baseNote,
    );
    await authedPost(rig, `/api/notes/${note.id}/shares`, owner.token, {
      userId: alice.userId,
      role: "edit",
    });
    const ownerSock = openSocket(rig.wsUrl, owner.token);
    await waitOpen(ownerSock.ws);
    await new Promise((r) => setTimeout(r, 50));
    ownerSock.ws.send(
      JSON.stringify({ type: "presence:update", noteId: note.id }),
    );
    await new Promise((r) => setTimeout(r, 50));
    return { owner, alice, note, ownerSock };
  }

  const joinsFor = (
    seen: { type: string; noteId?: string; user?: { id: string } }[],
    noteId: string,
  ) =>
    seen
      .filter((e) => e.type === "presence:join" && e.noteId === noteId)
      .map((e) => e.user?.id);

  it("shows someone who accepts a note who is already looking at it", async () => {
    const { owner, alice, note, ownerSock } = await noteViewedByOwner();
    const aliceSock = openSocket(rig.wsUrl, alice.token);
    await waitOpen(aliceSock.ws);
    await new Promise((r) => setTimeout(r, 50));
    const toAlice = collect(aliceSock.ws);

    // Not hers yet: an invitation shows her nobody.
    expect(joinsFor(toAlice(), note.id)).toEqual([]);

    await authedPost(
      rig,
      `/api/invitations/${note.id}/accept`,
      alice.token,
      {},
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(joinsFor(toAlice(), note.id)).toEqual([owner.userId]);

    // And from now on she hears the owner leave, without opening the note.
    ownerSock.ws.send(
      JSON.stringify({ type: "presence:update", noteId: null }),
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(toAlice()).toContainEqual(
      expect.objectContaining({ type: "presence:leave", noteId: note.id }),
    );

    ownerSock.ws.close();
    aliceSock.ws.close();
  });

  it("tells a socket that opens later who is already on the notes it can see", async () => {
    const { owner, alice, note, ownerSock } = await noteViewedByOwner();
    await authedPost(
      rig,
      `/api/invitations/${note.id}/accept`,
      alice.token,
      {},
    );

    const aliceSock = openSocket(rig.wsUrl, alice.token);
    const toAlice = collect(aliceSock.ws);
    await waitOpen(aliceSock.ws);
    await new Promise((r) => setTimeout(r, 100));
    expect(joinsFor(toAlice(), note.id)).toEqual([owner.userId]);

    ownerSock.ws.close();
    aliceSock.ws.close();
  });
});

describe("heartbeat on /api/ws", () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await bootRig(50);
  });

  afterEach(async () => {
    await close(rig);
  });

  it("sends a heartbeat the page can see", async () => {
    const token = await register(rig, "alice");
    const { ws } = openSocket(rig.wsUrl, token);
    await waitOpen(ws);

    const first = await new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(data.toString()));
    });
    expect(JSON.parse(first)).toEqual({ type: "heartbeat" });

    ws.close();
  });

  it("drops a peer that stops answering pings, and keeps one that answers", async () => {
    // A browser answers a protocol ping without the page taking part, so a
    // peer that does not answer is one that is no longer there. `autoPong:
    // false` is that peer, seen from the server.
    const token = await register(rig, "alice");
    const gone = new WebSocket(rig.wsUrl, [SUBPROTOCOL, token], {
      autoPong: false,
    });
    const here = openSocket(rig.wsUrl, token);
    await waitOpen(gone);
    await waitOpen(here.ws);

    const code = await new Promise<number>((resolve) => {
      gone.once("close", (c) => resolve(c));
    });
    // 1006: terminated without a closing handshake, which a vanished peer
    // could never have completed.
    expect(code).toBe(1006);
    expect(here.ws.readyState).toBe(WebSocket.OPEN);

    here.ws.close();
  });
});
