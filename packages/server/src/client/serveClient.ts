import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/**
 * Serves the built client from `dir` at the site root, beside the API, so one
 * container is the whole of a connected-mode deployment: one origin, so no
 * CORS to configure and a client CSP of `connect-src 'self'` that already
 * reaches the API and both sockets. The client in the image is built with its
 * server set to `/`, the same-origin form `resolveServerUrl` understands.
 *
 * Hashed assets are cached for good; the page, the manifest and the service
 * worker are revalidated every time, or an update would never reach anyone.
 * Any other path without a file extension is a client route and gets the
 * page, as the GitHub Pages fallback does for the static build. The headers
 * a `<meta>` CSP cannot carry (`frame-ancestors`) go on every response.
 */
export function mountClient(app: Hono, dir: string): void {
  const root = resolve(dir);
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`CLIENT_DIR has no index.html: ${root}`);
  }
  // Read once: it is small, and every client route answers with it.
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
  // Mounted after the API, so its routes answer first; an unknown API path
  // falls through here and on to a 404, never to the page.
  app.get("*", async (c, next) => {
    if (isApi(c.req.path)) return next();
    // A file it found comes back as its own response; a miss has gone on to
    // the page (or the 404) through `next`.
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
    if (isApi(path) || /\.[^/]+$/.test(path)) return next();
    return c.body(new Uint8Array(index), 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  });
}
