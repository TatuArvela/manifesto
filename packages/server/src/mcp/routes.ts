import { hasScope } from "@manifesto/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { type AuthContext, MCP_FORWARDED } from "#/middleware/authBearer.ts";
import {
  errorResponse,
  handleMessage,
  JSON_RPC_ERRORS,
  type JsonRpcResponse,
  type McpContext,
  PROTOCOL_VERSIONS,
} from "./protocol.ts";
import { MCP_TOOLS, type RestCall } from "./tools.ts";

interface McpDeps {
  /** The origins from which a browser can call (`CORS_ORIGINS`). */
  corsOrigins: string[];
  serverVersion: string;
  /** Runs a request through the full app, as `app.fetch` does. */
  forward: (request: Request, env: object) => Response | Promise<Response>;
}

/**
 * The maximum number of messages in one batch. One request answers a batch.
 * Thus, the rate limit on the endpoint counts it one time, whatever its length.
 * The messages that reach no route (`ping`, `tools/list`, an unknown method)
 * are counted in no other place.
 */
export const MAX_BATCH = 50;

/**
 * `/api/v1/mcp`: the MCP endpoint, as the "Streamable HTTP" transport of the
 * protocol, in its stateless form. A client POSTs one JSON-RPC message (or,
 * with protocol 2025-03-26, a batch), and gets the answer as JSON: 200 for a
 * request, 202 for a message that needs no answer. Nothing streams. Thus, a GET
 * for a server-sent stream and a DELETE of a session get 405. The protocol says
 * that a server declines them in this way.
 *
 * Only an MCP token opens it (`mfm_`, made in Settings). The tools run as REST
 * requests through the same app, with that token (see `tools.ts`).
 */
export function createMcpRoutes(deps: McpDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();

  // The protocol asks a server to check Origin, against DNS rebinding. A page
  // on a different site must not reach a server on the network of the user
  // through their browser. An assistant is not a browser, and sends no Origin.
  const checkOrigin: MiddlewareHandler = async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !deps.corsOrigins.includes(origin)) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        // not a URL: refused below
      }
      if (host === null || host !== c.req.header("Host")) {
        return c.json({ error: "Origin not allowed" }, 403);
      }
    }
    return next();
  };

  routes.post("/", checkOrigin, async (c) => {
    const { scopes = [] } = c.get("auth");
    const reply = (body: JsonRpcResponse, status: 200 | 400 | 415 = 200) =>
      c.json(body, status);

    if (!c.req.header("Content-Type")?.includes("application/json")) {
      return reply(
        errorResponse(
          null,
          JSON_RPC_ERRORS.invalidRequest,
          "Send JSON (Content-Type: application/json)",
        ),
        415,
      );
    }
    // Sent only after `initialize`. Absent means that the client did not say.
    const version = c.req.header("MCP-Protocol-Version");
    if (version && !PROTOCOL_VERSIONS.some((v) => v === version)) {
      return reply(
        errorResponse(
          null,
          JSON_RPC_ERRORS.invalidRequest,
          `Unsupported protocol version ${version}; this server speaks ${PROTOCOL_VERSIONS.join(", ")}`,
        ),
        400,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return reply(
        errorResponse(null, JSON_RPC_ERRORS.parse, "Not valid JSON"),
        400,
      );
    }

    const authorization = c.req.header("Authorization") ?? "";
    const forwardedFor = c.req.header("X-Forwarded-For");
    const rest: RestCall = async (method, path, options = {}) => {
      const headers = new Headers({ Authorization: authorization });
      if (options.body !== undefined) {
        headers.set("Content-Type", "application/json");
      }
      if (options.ifMatch !== undefined) {
        headers.set("If-Match", options.ifMatch);
      }
      // Thus, the rate limit and each audit line see the address of the
      // assistant.
      if (forwardedFor) headers.set("X-Forwarded-For", forwardedFor);
      const res = await deps.forward(
        new Request(new URL(path, c.req.url), {
          method,
          headers,
          ...(options.body !== undefined && {
            body: JSON.stringify(options.body),
          }),
        }),
        { ...(c.env as object | undefined), [MCP_FORWARDED]: true },
      );
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: res.status, body: parsed };
    };
    const ctx: McpContext = {
      tools: MCP_TOOLS.filter((t) => hasScope(scopes, t.scope)),
      rest,
      serverVersion: deps.serverVersion,
    };

    if (Array.isArray(body)) {
      if (body.length === 0) {
        return reply(
          errorResponse(null, JSON_RPC_ERRORS.invalidRequest, "An empty batch"),
          400,
        );
      }
      if (body.length > MAX_BATCH) {
        return reply(
          errorResponse(
            null,
            JSON_RPC_ERRORS.invalidRequest,
            `A batch holds at most ${MAX_BATCH} messages`,
          ),
          400,
        );
      }
      const answers: JsonRpcResponse[] = [];
      for (const message of body) {
        const answer = await handleMessage(message, ctx);
        if (answer) answers.push(answer);
      }
      return answers.length > 0 ? c.json(answers) : c.body(null, 202);
    }
    const answer = await handleMessage(body, ctx);
    return answer ? reply(answer) : c.body(null, 202);
  });

  routes.all("/", (c) =>
    c.json(
      errorResponse(
        null,
        JSON_RPC_ERRORS.invalidRequest,
        "This server answers POST only: it keeps no sessions and opens no streams",
      ),
      405,
      { Allow: "POST" },
    ),
  );

  return routes;
}
