import type {
  ApiTokenCreatedResponse,
  CapabilitiesResponse,
  Note,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

interface RpcAnswer {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolAnswer {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

type BriefNote = Pick<
  Note,
  "id" | "title" | "content" | "tags" | "trashed" | "updatedAt"
> & { role: string };

describe("MCP endpoint", () => {
  let rig: TestRig;
  let session: string;
  let nextId = 1;

  beforeEach(async () => {
    rig = await bootTestApp();
    ({ token: session } = await registerTestUser(rig, "alice"));
  });

  afterEach(async () => {
    await rig.close();
  });

  async function mint(
    body: object,
    as: string = session,
  ): Promise<ApiTokenCreatedResponse> {
    const res = await rig.request("/api/tokens", {
      method: "POST",
      headers: authHeaders(as),
      body: JSON.stringify({ password: "test-pass-12", ...body }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as ApiTokenCreatedResponse;
  }

  const mintMcp = async (readOnly = false, as: string = session) =>
    (
      await mint(
        {
          name: "assistant",
          kind: "mcp",
          ...(readOnly && { scopes: ["notes:read"] }),
        },
        as,
      )
    ).secret;

  function post(token: string | null, body: unknown, headers = {}) {
    return rig.request("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async function rpc(token: string, method: string, params?: object) {
    const res = await post(token, {
      jsonrpc: "2.0",
      id: nextId++,
      method,
      ...(params && { params }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as RpcAnswer;
  }

  async function tool(token: string, name: string, args: object = {}) {
    const answer = await rpc(token, "tools/call", { name, arguments: args });
    expect(answer.error).toBeUndefined();
    return answer.result as unknown as ToolAnswer;
  }

  async function noteFrom(token: string, name: string, args: object) {
    const result = await tool(token, name, args);
    expect(result.isError).toBeUndefined();
    return (result.structuredContent as { note: BriefNote }).note;
  }

  describe("the protocol", () => {
    it("agrees on the version the client asks for, or offers the newest", async () => {
      const token = await mintMcp();
      const asked = await rpc(token, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      });
      expect(asked.result).toMatchObject({
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "manifesto" },
      });
      const unknown = await rpc(token, "initialize", {
        protocolVersion: "1999-01-01",
      });
      expect(unknown.result?.protocolVersion).toBe("2025-11-25");
    });

    it("keeps no session: a notification is accepted and nothing streams", async () => {
      const token = await mintMcp();
      const init = await post(token, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });
      expect(init.headers.get("Mcp-Session-Id")).toBeNull();
      const note = await post(token, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      expect(note.status).toBe(202);
      expect(await note.text()).toBe("");
      for (const method of ["GET", "DELETE"]) {
        const res = await rig.request("/api/mcp", {
          method,
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(405);
        expect(res.headers.get("Allow")).toBe("POST");
      }
    });

    it("answers what it cannot handle with the JSON-RPC error for it", async () => {
      const token = await mintMcp();
      const garbled = await post(token, "{not json");
      expect(garbled.status).toBe(400);
      expect(((await garbled.json()) as RpcAnswer).error?.code).toBe(-32700);

      const plain = await post(token, "ping", { "Content-Type": "text/plain" });
      expect(plain.status).toBe(415);

      const version = await post(
        token,
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { "MCP-Protocol-Version": "2020-01-01" },
      );
      expect(version.status).toBe(400);

      expect((await rpc(token, "resources/list")).error?.code).toBe(-32601);
      expect(
        (await rpc(token, "tools/call", { name: "drop_tables" })).error?.code,
      ).toBe(-32602);
    });

    it("answers each request of a batch and none of its notifications", async () => {
      const token = await mintMcp();
      const res = await post(token, [
        { jsonrpc: "2.0", id: "a", method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ]);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        { jsonrpc: "2.0", id: "a", result: {} },
      ]);
    });
  });

  describe("who may use it", () => {
    it("opens to an MCP token and nothing else", async () => {
      const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
      expect((await post(null, ping)).status).toBe(401);
      expect((await post(session, ping)).status).toBe(403);
      const { secret: script } = await mint({ name: "script" });
      expect((await post(script, ping)).status).toBe(403);
      expect((await post(await mintMcp(), ping)).status).toBe(200);
    });

    it("keeps an MCP token to /api/mcp", async () => {
      const token = await mintMcp();
      for (const [method, path] of [
        ["GET", "/api/notes"],
        ["GET", "/api/auth/me"],
        ["GET", "/api/tokens"],
        ["GET", "/api/export"],
      ] as const) {
        const res = await rig.request(path, {
          method,
          headers: authHeaders(token),
        });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    });

    it("refuses a browser page from another site", async () => {
      const token = await mintMcp();
      const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
      expect(
        (await post(token, ping, { Origin: "https://evil.example" })).status,
      ).toBe(403);
      expect(
        (
          await post(token, ping, {
            Origin: "https://notes.example",
            Host: "notes.example",
          })
        ).status,
      ).toBe(200);
    });

    it("stops working once revoked", async () => {
      const { secret, token } = await mint({ name: "assistant", kind: "mcp" });
      await rig.request(`/api/tokens/${token.id}`, {
        method: "DELETE",
        headers: authHeaders(session),
      });
      expect(
        (await post(secret, { jsonrpc: "2.0", id: 1, method: "ping" })).status,
      ).toBe(401);
    });

    it("gives an MCP token the note scopes and nothing more", async () => {
      const res = await rig.request("/api/tokens", {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({
          name: "assistant",
          kind: "mcp",
          scopes: ["notes:read", "account:read"],
        }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe("the tools", () => {
    it("create, read, change and trash a note through the notes API", async () => {
      const token = await mintMcp();
      const created = await noteFrom(token, "create_note", {
        title: "Groceries",
        content: "- [ ] milk",
        tags: ["home"],
      });
      expect(created).toMatchObject({ title: "Groceries", role: "owner" });
      expect(created).not.toHaveProperty("position");

      const read = await noteFrom(token, "get_note", { id: created.id });
      expect(read.content).toBe("- [ ] milk");

      const changed = await noteFrom(token, "update_note", {
        id: created.id,
        updatedAt: read.updatedAt,
        content: "- [ ] milk\n- [ ] eggs",
      });
      expect(changed.content).toContain("eggs");

      // The same updatedAt again: someone changed it since.
      const stale = await tool(token, "update_note", {
        id: created.id,
        updatedAt: read.updatedAt,
        title: "Shopping",
      });
      expect(stale.isError).toBe(true);
      expect(stale.content[0]?.text).toContain("changed since you read it");

      const trashed = await noteFrom(token, "trash_note", { id: created.id });
      expect(trashed.trashed).toBe(true);
      const inTrash = await tool(token, "list_notes", { view: "trashed" });
      expect(JSON.stringify(inTrash.structuredContent)).toContain(created.id);
      const restored = await noteFrom(token, "update_note", {
        id: created.id,
        trashed: false,
      });
      expect(restored.trashed).toBe(false);
    });

    it("puts a new note ahead of the others, as the web client does", async () => {
      const token = await mintMcp();
      const first = await noteFrom(token, "create_note", { content: "one" });
      const second = await noteFrom(token, "create_note", { content: "two" });
      const position = async (id: string) =>
        (
          (await (
            await rig.request(`/api/notes/${id}`, {
              headers: authHeaders(session),
            })
          ).json()) as { note: Note }
        ).note.position;
      expect(await position(second.id)).toBeLessThan(await position(first.id));
    });

    it("search and count tags over the user's notes", async () => {
      const token = await mintMcp();
      await noteFrom(token, "create_note", {
        content: "boiler service",
        tags: ["home", "bills"],
      });
      await noteFrom(token, "create_note", { content: "rent", tags: ["home"] });
      const found = await tool(token, "search_notes", { query: "boiler" });
      const { notes } = found.structuredContent as { notes: BriefNote[] };
      expect(notes.map((n) => n.content)).toEqual(["boiler service"]);
      const tags = await tool(token, "list_tags");
      expect(tags.structuredContent).toEqual({
        tags: [
          { tag: "home", count: 2 },
          { tag: "bills", count: 1 },
        ],
      });
    });

    it("say what was wrong with the arguments", async () => {
      const token = await mintMcp();
      const result = await tool(token, "update_note", { id: "x" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("at least one field");
    });

    it("offer a read-only token only what reads, and refuse it the rest", async () => {
      const token = await mintMcp(true);
      const listed = await rpc(token, "tools/list");
      const { tools } = listed.result as { tools: { name: string }[] };
      const names = tools.map((t) => t.name);
      expect(names.sort()).toEqual([
        "get_note",
        "list_notes",
        "list_tags",
        "search_notes",
      ]);
      const refused = await rpc(token, "tools/call", {
        name: "create_note",
        arguments: { content: "no" },
      });
      expect(refused.error?.code).toBe(-32602);
    });

    it("keep to the role a share gives", async () => {
      const bob = await registerTestUser(rig, "bob");
      const res = await rig.request("/api/notes", {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({
          title: "Plan",
          content: "shared",
          color: "default",
          font: "default",
          pinned: false,
          archived: false,
          trashed: false,
          position: 0,
          tags: [],
          images: [],
          linkPreviews: [],
          reminder: null,
        }),
      });
      const { note } = (await res.json()) as { note: Note };
      await rig.request(`/api/notes/${note.id}/shares`, {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({ userId: bob.userId, role: "view" }),
      });
      await rig.request(`/api/invitations/${note.id}/accept`, {
        method: "POST",
        headers: authHeaders(bob.token),
      });
      const token = await mintMcp(false, bob.token);
      const read = await noteFrom(token, "get_note", { id: note.id });
      expect(read.role).toBe("view");
      const refused = await tool(token, "update_note", {
        id: note.id,
        content: "overwritten",
      });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toContain("403");
    });
  });
});

describe("MCP turned off", () => {
  let rig: TestRig;
  let session: string;

  beforeEach(async () => {
    rig = await bootTestAppWith({ mcp: false });
    ({ token: session } = await registerTestUser(rig, "alice"));
  });

  afterEach(async () => {
    await rig.close();
  });

  it("has no endpoint, mints no MCP token, and says so", async () => {
    const endpoint = await rig.request("/api/mcp", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(endpoint.status).toBe(404);
    const mint = await rig.request("/api/tokens", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        name: "assistant",
        kind: "mcp",
        password: "test-pass-12",
      }),
    });
    expect(mint.status).toBe(403);
    const { features } = (await (
      await rig.request("/api/capabilities")
    ).json()) as CapabilitiesResponse;
    expect(features.mcp).toBe(false);
  });
});
