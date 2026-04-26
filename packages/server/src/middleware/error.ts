import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "../lib/logger.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const onError: ErrorHandler = (err, c) => handleError(c, err);

function handleError(c: Context, err: unknown) {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as never);
  }
  if (err instanceof HTTPException) {
    return c.json(
      { error: err.message || "Request failed" },
      err.status as never,
    );
  }
  logger.error("Unhandled server error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return c.json({ error: "Internal server error" }, 500);
}
