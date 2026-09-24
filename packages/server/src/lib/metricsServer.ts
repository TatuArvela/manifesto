import { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import { renderMetrics } from "./metrics.js";
import { safeEqual } from "./token.js";

/**
 * `/metrics` as a handler of its own, mounted on the main app or on the
 * separate `METRICS_PORT` listener.
 *
 * On the main port it answers only with `METRICS_TOKEN`, since that port is
 * the public one. On its own port the port is the boundary (loopback by
 * default, or a Docker network), so the token is asked for only when set.
 * Anything refused is a plain 404, the same as a path that does not exist.
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

/** The app `METRICS_PORT` serves: `/metrics` and nothing else. */
export function createMetricsApp(
  cfg: Pick<ServerConfig, "metricsToken">,
  version: string,
): Hono {
  const app = new Hono();
  app.get("/metrics", metricsHandler(cfg, version, false));
  return app;
}
