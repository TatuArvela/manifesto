import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { ServerConfig } from "../config.js";

export function corsMiddleware(cfg: ServerConfig): MiddlewareHandler {
  const origins = cfg.corsOrigins;
  return cors({
    origin: (incoming) => {
      if (!incoming) return null;
      return origins.includes(incoming) ? incoming : null;
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false,
    maxAge: 600,
  });
}
