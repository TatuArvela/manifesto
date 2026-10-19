import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { ServerConfig } from "#/config.ts";

/**
 * What an assistant calls to sign in to `/api/v1/mcp`, some from a web page
 * (the MCP Inspector, a browser-based agent). None of it contains a credential
 * that the browser would add by itself. Thus, all pages can call it: the
 * metadata, and the endpoints where a public client registers and trades codes.
 */
function isOpenToAnyOrigin(path: string): boolean {
  return (
    path.startsWith("/.well-known/oauth-") ||
    path === "/api/v1/oauth/register" ||
    path === "/api/v1/oauth/token"
  );
}

export function corsMiddleware(cfg: ServerConfig): MiddlewareHandler {
  const origins = cfg.corsOrigins;
  const configured = cors({
    origin: (incoming) => {
      if (!incoming) return null;
      return origins.includes(incoming) ? incoming : null;
    },
    // `If-Match` contains the optimistic-concurrency token on each update of a
    // note that the client already has. If it is not here, the browser refuses
    // the request before it goes out. `X-Forwarded-For` is the probe that the
    // setup checks of the admin send. To permit it gives nothing away. All
    // clients other than a browser can already send it. The server believes it
    // only with `TRUST_PROXY`, behind a proxy that replaces it.
    // `X-Attachment-Address` names a sealed image on its upload. The body is
    // ciphertext. Thus, the server cannot find the image in a different way.
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "If-Match",
      "X-Attachment-Address",
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
