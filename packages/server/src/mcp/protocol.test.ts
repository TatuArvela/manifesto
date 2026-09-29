import { describe, expect, it, vi } from "vitest";
import { logger } from "../lib/logger.js";
import {
  handleMessage,
  JSON_RPC_ERRORS,
  type McpContext,
  PROTOCOL_VERSIONS,
} from "./protocol.js";
import type { McpTool, RestCall } from "./tools.js";

const rest: RestCall = async () => {
  throw new Error("no REST call expected");
};

function tool(
  name: string,
  call: McpTool["call"] = async () => ({
    content: [{ type: "text", text: name }],
  }),
): McpTool {
  return {
    name,
    title: `The ${name} tool`,
    description: `Does ${name}`,
    inputSchema: { type: "object" },
    scope: "notes:read",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    call,
  };
}

function ctx(tools: McpTool[] = [tool("echo")]): McpContext {
  return { tools, rest, serverVersion: "9.9.9" };
}

function errorCode(response: unknown): number | undefined {
  return (response as { error?: { code: number } }).error?.code;
}

describe("handleMessage", () => {
  it("refuses what is not JSON-RPC 2.0, with no id to answer to", async () => {
    for (const message of [
      null,
      42,
      "initialize",
      [],
      { method: "ping", id: 1 },
      { jsonrpc: "1.0", method: "ping", id: 1 },
    ]) {
      const response = await handleMessage(message, ctx());
      expect(response, JSON.stringify(message)).toMatchObject({
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_ERRORS.invalidRequest },
      });
    }
  });

  it("answers no notification and no response from the client", async () => {
    expect(
      await handleMessage(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        ctx(),
      ),
    ).toBeNull();
    // A response has no method: this server never asked anything.
    expect(
      await handleMessage({ jsonrpc: "2.0", id: 7, result: {} }, ctx()),
    ).toBeNull();
  });

  it("does not run a tool for a notification", async () => {
    const call = vi.fn(tool("echo").call);
    const response = await handleMessage(
      { jsonrpc: "2.0", method: "tools/call", params: { name: "echo" } },
      ctx([tool("echo", call)]),
    );
    expect(response).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses an id that is neither a string nor a number", async () => {
    for (const id of [null, true, { n: 1 }, [1]]) {
      const response = await handleMessage(
        { jsonrpc: "2.0", id, method: "ping" },
        ctx(),
      );
      expect(response, JSON.stringify(id)).toMatchObject({
        id: null,
        error: { code: JSON_RPC_ERRORS.invalidRequest },
      });
    }
  });

  it("answers on the id it was asked with, string or number", async () => {
    expect(
      await handleMessage({ jsonrpc: "2.0", id: "a", method: "ping" }, ctx()),
    ).toEqual({ jsonrpc: "2.0", id: "a", result: {} });
    expect(
      await handleMessage({ jsonrpc: "2.0", id: 0, method: "ping" }, ctx()),
    ).toEqual({ jsonrpc: "2.0", id: 0, result: {} });
  });

  it("agrees on a version it knows and offers the newest otherwise", async () => {
    const init = async (protocolVersion: unknown) =>
      (await handleMessage(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion },
        },
        ctx(),
      )) as { result: Record<string, unknown> };
    for (const known of PROTOCOL_VERSIONS) {
      expect((await init(known)).result.protocolVersion).toBe(known);
    }
    for (const unknown of ["2020-01-01", 42, undefined]) {
      expect((await init(unknown)).result.protocolVersion).toBe(
        PROTOCOL_VERSIONS[0],
      );
    }
    const { result } = await init(PROTOCOL_VERSIONS[0]);
    expect(result.serverInfo).toEqual({ name: "manifesto", version: "9.9.9" });
    // Stateless: tools only, and a list that never changes under the client.
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
  });

  it("lists only the tools in its context, with their annotations titled", async () => {
    const response = (await handleMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      ctx([tool("a"), tool("b")]),
    )) as { result: { tools: Array<Record<string, unknown>> } };
    expect(response.result.tools.map((t) => t.name)).toEqual(["a", "b"]);
    expect(response.result.tools[0]).toEqual({
      name: "a",
      title: "The a tool",
      description: "Does a",
      inputSchema: { type: "object" },
      annotations: {
        title: "The a tool",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    // Not the scope or the function: nothing of the server's own.
    expect(response.result.tools[0]).not.toHaveProperty("scope");
  });

  it("refuses a tool the caller was not offered, whatever it is called", async () => {
    const call = vi.fn(tool("secret").call);
    for (const name of ["secret", undefined, "__proto__", "constructor"]) {
      const response = await handleMessage(
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name } },
        ctx([tool("echo")]),
      );
      expect(errorCode(response), String(name)).toBe(
        JSON_RPC_ERRORS.invalidParams,
      );
    }
    expect(call).not.toHaveBeenCalled();
  });

  it("hands a tool its arguments and the REST caller", async () => {
    const call = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    const response = await handleMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "echo", arguments: { q: "x" } },
      },
      ctx([tool("echo", call)]),
    );
    expect(call).toHaveBeenCalledWith({ q: "x" }, rest);
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: { content: [{ type: "text", text: "ok" }] },
    });
  });

  it("answers a tool that throws with an internal error that says nothing of why", async () => {
    const quiet = vi.spyOn(logger, "error").mockImplementation(() => {});
    const response = await handleMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom" } },
      ctx([
        tool("boom", async () => {
          throw new Error("database password is hunter2");
        }),
      ]),
    );
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: JSON_RPC_ERRORS.internal, message: "The tool failed" },
    });
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("answers a method it does not know, and reads params that are not an object as none", async () => {
    expect(
      errorCode(
        await handleMessage(
          { jsonrpc: "2.0", id: 6, method: "resources/list" },
          ctx(),
        ),
      ),
    ).toBe(JSON_RPC_ERRORS.methodNotFound);
    expect(
      errorCode(
        await handleMessage(
          { jsonrpc: "2.0", id: 6, method: "tools/call", params: ["echo"] },
          ctx(),
        ),
      ),
    ).toBe(JSON_RPC_ERRORS.invalidParams);
  });
});
