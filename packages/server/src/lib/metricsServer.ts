import { Hono } from "hono";
import type { ServerConfig } from "#/config.ts";
import { renderMetrics } from "./metrics.ts";
import { safeEqual } from "./token.ts";

/**
 * `/metrics` as its own handler, mounted on the main app or on the separate
 * `METRICS_PORT` listener.
 *
 * On the main port, it answers only with `METRICS_TOKEN`, because that port is
 * public. On its own port, the port is the boundary (loopback by default, or a
 * Docker network). Thus, it asks for the token only when it is set. Each
 * refusal is a plain 404, the same as for a path that does not exist.
 */
export function metricsHandler(
  cfg: Pick<ServerConfig, "metricsToken">,
  version: string,
  tokenRequired: boolean,
) {
  return async (c: {
    req: { header(name: string): string | undefined };
    text(body: string, status: 200, headers: Record<string, string>): Response;
    notFound(): Response | Promise<Response>;
  }) => {
    const expected = cfg.metricsToken;
    if (tokenRequired && !expected) return c.notFound();
    if (
      expected &&
      !safeEqual(c.req.header("Authorization") ?? "", `Bearer ${expected}`)
    ) {
      return c.notFound();
    }
    return c.text(await renderMetrics(version), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    });
  };
}

/** The app that `METRICS_PORT` serves: only `/metrics`. */
export function createMetricsApp(
  cfg: Pick<ServerConfig, "metricsToken">,
  version: string,
): Hono {
  const app = new Hono();
  app.get("/metrics", metricsHandler(cfg, version, false));
  return app;
}
