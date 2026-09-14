import type { AddressInfo } from "node:net";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import type { SqliteStorageDriver } from "../storage/sqlite/driver.js";
import { createSqliteStorage } from "../storage/sqlite/driver.js";
import { TEST_CONFIG } from "../test/setup.js";
import { attachAppSocket } from "./appSocket.js";
import { attachYjsSocket, type YjsSocket } from "./yjsSocket.js";

interface Rig {
  storage: SqliteStorageDriver;
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
  const cfg = { ...TEST_CONFIG, port: 0 };
  const storage = createSqliteStorage(cfg);
  const authProvider = createAuthProvider(cfg, storage);
  const { app, broadcaster, revocations, accessChanges } = createApp({
    cfg,
    storage,
    authProvider,
  });
  const ws = createNodeWebSocket({ app });
  attachAppSocket({
    app,
    ws,
    authProvider,
    broadcaster,
    revocations,
    accessChanges,
    storage,
    cfg,
  });
  // biome-ignore lint/suspicious/noExplicitAny: cast around hono-node-server's union return type
  const server = serve({ fetch: app.fetch, port: 0 }) as any;
  await new Promise<void>((resolve) => server.once("listening", resolve));
  ws.injectWebSocket(server);
  const yjs = attachYjsSocket({
    httpServer: server,
    storage,
    authProvider,
    revocations,
    accessChanges,
    cfg,
  });
  const port = (server.address() as AddressInfo).port;
  return {
    storage,
    server,
    yjs,
    baseUrl: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
  };
}

async function close(rig: Rig): Promise<void> {
  await rig.yjs.destroy();
  await new Promise<void>((resolve) => rig.server.close(() => resolve()));
  await rig.storage.close();
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

async function signIn(rig: Rig, username: string): Promise<string> {
  const res = await fetch(`${rig.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "password-1234" }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
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

async function shareWith(
  rig: Rig,
  ownerToken: string,
  noteId: string,
  recipient: { token: string; userId: string },
  role: "edit" | "view",
): Promise<void> {
  const invited = await fetch(`${rig.baseUrl}/api/notes/${noteId}/shares`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({ userId: recipient.userId, role }),
  });
  expect(invited.status).toBe(201);
  const accepted = await fetch(
    `${rig.baseUrl}/api/invitations/${noteId}/accept`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${recipient.token}` },
    },
  );
  expect(accepted.status).toBe(200);
}

interface Client {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  destroy: () => void;
}

/**
 * Drives the real @hocuspocus/provider against the real server over a real
 * socket. Everything between the HTTP upgrade and document persistence (the
 * routing key, the Auth handshake, onAuthenticate) is only exercised this way;
 * openDirectConnection bypasses all of it.
 */
function connect(rig: Rig, noteId: string, token: string | null): Client {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `${rig.wsBase}/api/yjs`,
    name: noteId,
    document: doc,
    token: token ?? "",
  });
  return {
    provider,
    doc,
    // destroy() tears down the socket too, since the provider created it.
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}

function waitSynced(client: Client, ms = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    if (client.provider.isSynced) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    client.provider.on("synced", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function waitAuthFailed(client: Client, ms = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    client.provider.on("authenticationFailed", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe("Yjs collaboration socket /api/yjs", () => {
  let rig: Rig;

  beforeEach(async () => {
    rig = await bootRig();
  });

  afterEach(async () => {
    await close(rig);
  });

  it("syncs a real provider end to end", async () => {
    const { token } = await register(rig, "alice");
    const noteId = await createNote(rig, token);

    const client = connect(rig, noteId, token);
    expect(await waitSynced(client)).toBe(true);
    client.destroy();
  });

  it("propagates edits between two clients on the same note", async () => {
    const { token } = await register(rig, "alice");
    const noteId = await createNote(rig, token);

    const a = connect(rig, noteId, token);
    const b = connect(rig, noteId, token);
    expect(await waitSynced(a)).toBe(true);
    expect(await waitSynced(b)).toBe(true);

    a.doc.getText("scratch").insert(0, "from A");

    const seen = await new Promise<string>((resolve) => {
      const timer = setTimeout(
        () => resolve(b.doc.getText("scratch").toString()),
        3000,
      );
      b.doc.getText("scratch").observe(() => {
        clearTimeout(timer);
        resolve(b.doc.getText("scratch").toString());
      });
    });
    expect(seen).toBe("from A");

    a.destroy();
    b.destroy();
  });

  it("rejects a connection with no token", async () => {
    const { token } = await register(rig, "alice");
    const noteId = await createNote(rig, token);

    const client = connect(rig, noteId, null);
    expect(await waitAuthFailed(client)).toBe(true);
    expect(client.provider.isSynced).toBe(false);
    client.destroy();
  });

  it("rejects a connection with a bogus token", async () => {
    const { token } = await register(rig, "alice");
    const noteId = await createNote(rig, token);

    const client = connect(rig, noteId, "deadbeef");
    expect(await waitAuthFailed(client)).toBe(true);
    client.destroy();
  });

  it("rejects access to another user's note", async () => {
    const { token: aliceToken } = await register(rig, "alice");
    const noteId = await createNote(rig, aliceToken);
    const { token: bobToken } = await register(rig, "bob");

    const client = connect(rig, noteId, bobToken);
    expect(await waitAuthFailed(client)).toBe(true);
    client.destroy();
  });

  it("authorizes the document actually joined, not a note id from the URL", async () => {
    // Hocuspocus takes the document name from each frame rather than the path,
    // so the ownership check has to run against that name. Bob asking for
    // Alice's note by document name must fail even though his own token is
    // valid and he owns a different note.
    const { token: aliceToken } = await register(rig, "alice");
    const aliceNote = await createNote(rig, aliceToken);
    const { token: bobToken } = await register(rig, "bob");
    const bobNote = await createNote(rig, bobToken);

    const legitimate = connect(rig, bobNote, bobToken);
    expect(await waitSynced(legitimate)).toBe(true);
    legitimate.destroy();

    const crossTenant = connect(rig, aliceNote, bobToken);
    expect(await waitAuthFailed(crossTenant)).toBe(true);
    expect(crossTenant.provider.isSynced).toBe(false);
    crossTenant.destroy();
  });

  it("persists Y.Doc updates to SQLite via the YjsPersistenceExtension", async () => {
    const { token, userId } = await register(rig, "alice");
    const noteId = await createNote(rig, token, { content: "" });

    const conn = await rig.yjs.hocuspocus.openDirectConnection(noteId, {
      userId,
      noteId,
      ownerId: userId,
      token,
    });
    await conn.transact((doc) => {
      doc.getText("scratch").insert(0, "Hello, world.");
    });
    await rig.yjs.hocuspocus.flushPendingStores();
    await conn.disconnect();

    const persisted = await rig.storage.yjs.load(noteId, userId);
    expect(persisted).toBeInstanceOf(Buffer);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, new Uint8Array(persisted ?? Buffer.alloc(0)));
    expect(restored.getText("scratch").toString()).toBe("Hello, world.");
  });

  it("rehydrates a Y.Doc from previously persisted state", async () => {
    const { token, userId } = await register(rig, "alice");
    const noteId = await createNote(rig, token, { content: "" });

    const first = await rig.yjs.hocuspocus.openDirectConnection(noteId, {
      userId,
      noteId,
      ownerId: userId,
      token,
    });
    await first.transact((doc) => {
      doc.getText("scratch").insert(0, "persisted bytes");
    });
    await rig.yjs.hocuspocus.flushPendingStores();
    await first.disconnect();

    // Force the document out of Hocuspocus's in-memory cache so the next
    // openDirectConnection reads from storage via YjsPersistenceExtension.onLoadDocument.
    rig.yjs.hocuspocus.closeConnections(noteId);

    const second = await rig.yjs.hocuspocus.openDirectConnection(noteId, {
      userId,
      noteId,
      ownerId: userId,
      token,
    });
    let observed = "";
    await second.transact((doc) => {
      observed = doc.getText("scratch").toString();
    });
    await second.disconnect();
    expect(observed).toBe("persisted bytes");
  });

  it("disconnects the sessions a password change ends, and keeps its own", async () => {
    // A document connection closed alone only asks the peer to stop; the
    // socket has to go, and the reconnect has to meet a refused session.
    const { token: elsewhere } = await register(rig, "alice");
    const here = await signIn(rig, "alice");
    const noteId = await createNote(rig, here);

    const other = connect(rig, noteId, elsewhere);
    const own = connect(rig, noteId, here);
    expect(await waitSynced(other)).toBe(true);
    expect(await waitSynced(own)).toBe(true);

    const otherRefused = waitAuthFailed(other, 8000);
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
    expect(await otherRefused).toBe(true);

    // The session that made the change still edits live.
    const ownConnections = [...rig.yjs.hocuspocus.documents.values()].flatMap(
      (document) => document.getConnections(),
    );
    expect(ownConnections.map((c) => c.context.token)).toEqual([here]);

    other.destroy();
    own.destroy();
  }, 15_000);

  it("lets an editor of a shared note into its document, stored under the owner", async () => {
    const owner = await register(rig, "olivia");
    const alice = await register(rig, "alice");
    const noteId = await createNote(rig, owner.token);
    await shareWith(rig, owner.token, noteId, alice, "edit");

    const ownerClient = connect(rig, noteId, owner.token);
    const aliceClient = connect(rig, noteId, alice.token);
    try {
      expect(await waitSynced(ownerClient)).toBe(true);
      expect(await waitSynced(aliceClient)).toBe(true);

      const seen = new Promise<string>((resolve) => {
        ownerClient.doc.getText("scratch").observe(() => {
          resolve(ownerClient.doc.getText("scratch").toString());
        });
      });
      aliceClient.doc.getText("scratch").insert(0, "from a collaborator");
      expect(await seen).toBe("from a collaborator");

      // `flushPendingStores` starts the write without waiting for it.
      rig.yjs.hocuspocus.flushPendingStores();
      let stored = "";
      for (let i = 0; i < 50 && stored === ""; i++) {
        const persisted = await rig.storage.yjs.load(noteId, owner.userId);
        if (persisted) {
          const restored = new Y.Doc();
          Y.applyUpdate(restored, new Uint8Array(persisted));
          stored = restored.getText("scratch").toString();
        }
        if (stored === "") await new Promise((r) => setTimeout(r, 50));
      }
      expect(stored).toBe("from a collaborator");
    } finally {
      ownerClient.destroy();
      aliceClient.destroy();
    }
  });

  it("keeps someone who can only view a note out of its document", async () => {
    const owner = await register(rig, "olivia");
    const alice = await register(rig, "alice");
    const noteId = await createNote(rig, owner.token);
    await shareWith(rig, owner.token, noteId, alice, "view");

    const client = connect(rig, noteId, alice.token);
    expect(await waitAuthFailed(client)).toBe(true);
    client.destroy();
  });

  it("puts out an editor whose role is taken away, and refuses their return", async () => {
    const owner = await register(rig, "olivia");
    const alice = await register(rig, "alice");
    const noteId = await createNote(rig, owner.token);
    await shareWith(rig, owner.token, noteId, alice, "edit");

    const client = connect(rig, noteId, alice.token);
    expect(await waitSynced(client)).toBe(true);

    const refused = waitAuthFailed(client, 8000);
    const res = await fetch(
      `${rig.baseUrl}/api/notes/${noteId}/shares/${alice.userId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${owner.token}`,
        },
        body: JSON.stringify({ role: "view" }),
      },
    );
    expect(res.status).toBe(200);
    expect(await refused).toBe(true);
    client.destroy();
  }, 15_000);
});
