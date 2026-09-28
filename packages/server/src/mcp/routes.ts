import { hasScope } from "@manifesto/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AuthProvider } from "../auth/types.js";
import {
  type AuthContext,
  createAuthMiddleware,
  MCP_FORWARDED,
} from "../middleware/authBearer.js";
import {
  errorResponse,
  handleMessage,
  JSON_RPC_ERRORS,
  type JsonRpcResponse,
  type McpContext,
  PROTOCOL_VERSIONS,
} from "./protocol.js";
import { MCP_TOOLS, type RestCall } from "./tools.js";

interface McpDeps {
  authProvider: AuthProvider;
  /** The origins a browser may call from (`CORS_ORIGINS`). */
  corsOrigins: string[];
  serverVersion: string;
  /** Runs a request through the whole app, as `app.fetch` does. */
  forward: (request: Request, env: object) => Response | Promise<Response>;
  rateLimit?: MiddlewareHandler;
}

/**
 * `/api/mcp`: the MCP endpoint, as the protocol's "Streamable HTTP"
 * transport in its stateless form. A client POSTs one JSON-RPC message (or,
 * under protocol 2025-03-26, a batch) and gets the answer as JSON: 200 for a
 * request, 202 for what needs no answer. Nothing streams, so a GET for a
 * server-sent stream and a DELETE of a session are 405, which the protocol
 * says is how a server declines them.
 *
 * Only an MCP token opens it (`mfm_`, minted in Settings), and the tools run
 * as REST requests through the same app with that token (see `tools.ts`).
 */
export function createMcpRoutes(deps: McpDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();

  // The protocol asks a server to check Origin, against DNS rebinding: a page
  // on another site must not reach a server on the user's network through
  // their browser. An assistant is not a browser and sends none.
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
    await next();
  };

  const noLimit: MiddlewareHandler = (_c, next) => next();

  routes.post(
    "/",
    checkOrigin,
    createAuthMiddleware(deps.authProvider, { mcpOnly: true }),
    deps.rateLimit ?? noLimit,
    async (c) => {
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
      // Only sent after `initialize`; absent means the client did not say.
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
        // So the rate limit and any audit line see the assistant's address.
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
            errorResponse(
              null,
              JSON_RPC_ERRORS.invalidRequest,
              "An empty batch",
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
    },
  );

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
