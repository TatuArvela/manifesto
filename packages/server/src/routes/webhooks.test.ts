import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  Note,
  WebhookCreatedResponse,
  WebhookPayload,
  WebhooksResponse,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import { createStorage } from "../storage/index.js";
import type { StorageDriver } from "../storage/types.js";
import { authHeaders, TEST_CONFIG } from "../test/setup.js";
import {
  signDelivery,
  WEBHOOK_DISABLE_AFTER,
  type WebhookDispatcher,
} from "../webhooks/dispatcher.js";

interface Received {
  headers: IncomingMessage["headers"];
  body: string;
}

const baseNote = {
  title: "Hello",
  content: "",
  color: NoteColor.Default,
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

describe("webhooks", () => {
  let storage: StorageDriver;
  let request: (path: string, init?: RequestInit) => Promise<Response>;
  let dispatcher: WebhookDispatcher;
  let receiver: Server;
  let receiverUrl: string;
  let received: Received[];
  let status: number;

  beforeEach(async () => {
    received = [];
    status = 204;
    receiver = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.statusCode = status;
        res.end();
      });
    });
    await new Promise<void>((resolve) =>
      receiver.listen(0, "127.0.0.1", resolve),
    );
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

    const cfg = { ...TEST_CONFIG, webhooks: "public" as const };
    storage = await createStorage(cfg);
    const authProvider = createAuthProvider(cfg, storage);
    const handle = createApp({
      cfg,
      storage,
      authProvider,
      // The receiver is on loopback, which no real deployment may reach.
      webhookAddressPolicy: (address) => address === "127.0.0.1",
      webhookRetryDelaysMs: [0, 1],
    });
    dispatcher = handle.webhooks as WebhookDispatcher;
    request = async (path, init) => handle.app.request(path, init);
  });

  afterEach(async () => {
    await dispatcher.idle();
    dispatcher.stop();
    await new Promise((resolve) => receiver.close(resolve));
    await storage.close();
  });

  async function signUp(username: string): Promise<string> {
    const res = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "test-pass-12" }),
    });
    return ((await res.json()) as { token: string }).token;
  }

  const call = (token: string, method: string, path: string, body?: unknown) =>
    request(path, {
      method,
      headers: authHeaders(token),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  async function addWebhook(token: string, body: object = {}) {
    const res = await call(token, "POST", "/api/webhooks", {
      url: receiverUrl,
      ...body,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as WebhookCreatedResponse;
  }

  it("posts a signed note event for each change", async () => {
    const token = await signUp("alice");
    const { secret } = await addWebhook(token);
    const created = await call(token, "POST", "/api/notes", baseNote);
    const note = ((await created.json()) as { note: Note }).note;
    await call(token, "PUT", `/api/notes/${note.id}`, { title: "Renamed" });
    await call(token, "DELETE", `/api/notes/${note.id}`);
    await dispatcher.idle();

    const events = received.map((r) => JSON.parse(r.body) as WebhookPayload);
    expect(events.map((e) => e.event)).toEqual([
      "note.created",
      "note.updated",
      "note.deleted",
    ]);
    expect(events[1].event === "note.updated" && events[1].note.title).toBe(
      "Renamed",
    );
    const first = received[0];
    expect(first.headers["x-manifesto-event"]).toBe("note.created");
    expect(first.headers["x-manifesto-signature"]).toBe(
      signDelivery(
        secret,
        String(first.headers["x-manifesto-timestamp"]),
        first.body,
      ),
    );
  });

  it("sends only the events asked for, and nothing of other accounts", async () => {
    const alice = await signUp("alice");
    const bob = await signUp("bob");
    await addWebhook(alice, { events: ["note.deleted"] });
    const res = await call(alice, "POST", "/api/notes", baseNote);
    const note = ((await res.json()) as { note: Note }).note;
    await call(bob, "POST", "/api/notes", baseNote);
    await call(alice, "DELETE", `/api/notes/${note.id}`);
    await dispatcher.idle();
    expect(received.map((r) => JSON.parse(r.body).event)).toEqual([
      "note.deleted",
    ]);
  });

  it("records failures and switches off after enough in a row", async () => {
    const token = await signUp("alice");
    const { webhook } = await addWebhook(token);
    status = 500;
    for (let i = 0; i < WEBHOOK_DISABLE_AFTER; i++) {
      await call(token, "POST", "/api/notes", baseNote);
    }
    await dispatcher.idle();
    const listed = (await (
      await call(token, "GET", "/api/webhooks")
    ).json()) as WebhooksResponse;
    expect(listed.webhooks[0]).toMatchObject({
      id: webhook.id,
      active: false,
      lastStatus: 500,
      failureCount: WEBHOOK_DISABLE_AFTER,
    });
    expect(JSON.stringify(listed)).not.toContain("whsec_");

    const reenabled = await call(token, "PUT", `/api/webhooks/${webhook.id}`, {
      active: true,
    });
    expect(
      ((await reenabled.json()) as { webhook: { active: boolean } }).webhook
        .active,
    ).toBe(true);
  });

  it("sends a test ping and says how it went", async () => {
    const token = await signUp("alice");
    const { webhook } = await addWebhook(token);
    const res = await call(token, "POST", `/api/webhooks/${webhook.id}/test`);
    expect(await res.json()).toEqual({ status: 204, error: null });
    expect(JSON.parse(received[0].body).event).toBe("ping");
  });

  it("refuses to reach an address the policy does not allow", async () => {
    const token = await signUp("alice");
    const res = await call(token, "POST", "/api/webhooks", {
      url: "http://10.0.0.1/hook",
    });
    const { webhook } = (await res.json()) as WebhookCreatedResponse;
    const ping = await call(token, "POST", `/api/webhooks/${webhook.id}/test`);
    const outcome = (await ping.json()) as { error: string | null };
    expect(outcome.error).toMatch(/not public/i);
  });

  it("is session-only", async () => {
    const token = await signUp("alice");
    const minted = await call(token, "POST", "/api/tokens", { name: "x" });
    const { secret } = (await minted.json()) as { secret: string };
    expect((await call(secret, "GET", "/api/webhooks")).status).toBe(403);
  });
});

describe("webhooks switched off", () => {
  it("answers 404 and says so in the auth methods", async () => {
    const cfg = { ...TEST_CONFIG };
    const storage = await createStorage(cfg);
    const { app } = createApp({
      cfg,
      storage,
      authProvider: createAuthProvider(cfg, storage),
    });
    expect((await app.request("/api/webhooks")).status).toBe(404);
    const methods = await (await app.request("/api/auth/methods")).json();
    expect(methods.webhooks).toBe(false);
    await storage.close();
  });
});
