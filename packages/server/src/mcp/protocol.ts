import { logger } from "../lib/logger.js";
import type { McpTool, RestCall } from "./tools.js";

/**
 * The Model Context Protocol, as much of it as a server of tools needs:
 * `initialize`, `ping`, `tools/list` and `tools/call` over JSON-RPC 2.0.
 * Written here rather than taken from the SDK, whose server brings express,
 * cors and a dozen more packages for these four methods.
 *
 * Stateless: nothing is kept between requests, so there is no session id,
 * every request is answered on its own, and the server never starts a
 * message of its own. Everything this leaves out (prompts, resources,
 * sampling, subscriptions, server-sent events) is optional in the protocol,
 * and a client learns that from the capabilities `initialize` answers with.
 */

/** Newest first. The first is what a client asking for an unknown one gets. */
export const PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

type Id = string | number;

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: Id | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: Id | null;
      error: { code: number; message: string };
    };

export interface McpContext {
  /** The tools this caller may see and call. */
  tools: readonly McpTool[];
  rest: RestCall;
  serverVersion: string;
}

const INSTRUCTIONS =
  "These tools reach the user's notes on a Manifesto server: sticky notes " +
  "with a title, Markdown content, a colour and tags. Search or list before " +
  "creating, to avoid duplicates. Pass the updatedAt you read when changing " +
  "a note. Nothing can be deleted outright; trash_note moves a note to the " +
  "trash, from which update_note can restore it.";

export function errorResponse(
  id: Id | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeTool(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, ...tool.annotations },
  };
}

/**
 * The answer to one JSON-RPC message, or null for one that gets none: a
 * notification, or a response from the client (to a request this server
 * never sends).
 */
export async function handleMessage(
  message: unknown,
  ctx: McpContext,
): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return errorResponse(
      null,
      JSON_RPC_ERRORS.invalidRequest,
      "Not a JSON-RPC 2.0 message",
    );
  }
  if (typeof message.method !== "string") return null;
  if (!("id" in message)) return null;
  const { id } = message;
  if (typeof id !== "string" && typeof id !== "number") {
    return errorResponse(
      null,
      JSON_RPC_ERRORS.invalidRequest,
      "A request id is a string or a number",
    );
  }
  const params = isRecord(message.params) ? message.params : {};

  switch (message.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.find((v) => v === asked)
        ? (asked as string)
        : PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "manifesto", version: ctx.serverVersion },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: ctx.tools.map(describeTool) },
      };
    case "tools/call": {
      const tool = ctx.tools.find((t) => t.name === params.name);
      if (!tool) {
        return errorResponse(
          id,
          JSON_RPC_ERRORS.invalidParams,
          `Unknown tool: ${String(params.name)}`,
        );
      }
      try {
        return {
          jsonrpc: "2.0",
          id,
          result: await tool.call(params.arguments, ctx.rest),
        };
      } catch (err) {
        logger.error("MCP tool failed", {
          tool: tool.name,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        return errorResponse(id, JSON_RPC_ERRORS.internal, "The tool failed");
      }
    }
    default:
      return errorResponse(
        id,
        JSON_RPC_ERRORS.methodNotFound,
        `Unknown method: ${message.method}`,
      );
  }
}
