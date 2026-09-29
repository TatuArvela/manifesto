import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { ServerConfig } from "../config.js";

/**
 * What an assistant calls to sign in to `/api/mcp`, some from a web page (the
 * MCP Inspector, a browser-based agent). None of it carries a credential the
 * browser would add on its own, so any page may call it: the metadata, and
 * the endpoints a public client registers and trades codes at.
 */
function isOpenToAnyOrigin(path: string): boolean {
  return (
    path.startsWith("/.well-known/oauth-") ||
    path === "/api/oauth/register" ||
    path === "/api/oauth/token"
  );
}

export function corsMiddleware(cfg: ServerConfig): MiddlewareHandler {
  const origins = cfg.corsOrigins;
  const configured = cors({
    origin: (incoming) => {
      if (!incoming) return null;
      return origins.includes(incoming) ? incoming : null;
    },
    // `If-Match` carries the optimistic-concurrency token on every update of
    // a note the client already holds; without it here the browser refuses
    // the request before it is sent.
    // `X-Forwarded-For` is the probe the admin's setup checks send. Allowing
    // it gives nothing away: anything but a browser can send it already, and
    // the server believes it only with `TRUST_PROXY`, behind a proxy that
    // replaces it.
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "If-Match",
      "X-Forwarded-For",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false,
    maxAge: 600,
  });
  const open = cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "MCP-Protocol-Version"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: false,
    maxAge: 600,
  });
  return (c, next) =>
    isOpenToAnyOrigin(c.req.path) ? open(c, next) : configured(c, next);
}
