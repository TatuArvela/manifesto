import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/**
 * Serves the built client from `dir` at the site root, together with the API.
 * Thus, one container is the full connected-mode deployment. There is one
 * origin. Thus, there is no CORS to configure, and a client CSP of `connect-src
 * 'self'` already reaches the API and both sockets. The client in the image is
 * built with its server set to `/`, the same-origin form that
 * `resolveServerUrl` understands.
 *
 * Hashed assets are cached permanently. The page, the manifest and the service
 * worker are revalidated each time. If not, an update would never reach the
 * users. All other paths without a file extension are client routes, and get
 * the page, as the GitHub Pages fallback does for the static build. The headers
 * that a `<meta>` CSP cannot contain (`frame-ancestors`) go on each response.
 */
export function mountClient(app: Hono, dir: string): void {
  const root = resolve(dir);
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`CLIENT_DIR has no index.html: ${root}`);
  }
  // Read one time. It is small, and each client route answers with it.
  const index = readFileSync(indexPath);

  const isApi = (path: string) =>
    path === "/api" || path.startsWith("/api/") || path === "/metrics";

  app.use("*", async (c, next) => {
    await next();
    if (isApi(c.req.path)) return;
    c.header("Content-Security-Policy", "frame-ancestors 'self'");
    c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
  });

  const files = serveStatic({ root });
  // Mounted after the API. Thus, its routes answer first. An unknown API path
  // comes here, and then goes to a 404, never to the page.
  app.get("*", async (c, next) => {
    if (isApi(c.req.path)) return next();
    // A file that it found comes back as its own response. A miss went to the
    // page (or the 404) through `next`.
    const found = await files(c, next);
    if (!(found instanceof Response)) return;
    found.headers.set(
      "Cache-Control",
      c.req.path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    return found;
  });

  app.get("*", (c, next) => {
    const path = c.req.path;
    // A `.well-known` document that the server does not serve (the OAuth
    // documents with MCP off) is a 404, never the page. A client that reads it
    // as JSON must learn that there is none.
    if (isApi(path) || path.startsWith("/.well-known/")) return next();
    if (/\.[^/]+$/.test(path)) return next();
    return c.body(new Uint8Array(index), 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  });
}
