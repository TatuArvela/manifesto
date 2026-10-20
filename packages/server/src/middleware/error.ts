import type { ErrorCode, ErrorResponse } from "@manifesto/shared";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "#/lib/logger.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: ErrorCode,
  ) {
    super(message);
  }
}

/**
 * An email address that a different account has. It has a code, because the
 * same status also means a taken username, and the client tells the two
 * differently.
 */
export function emailTaken(): HttpError {
  return new HttpError(
    409,
    "Another account already uses this email address",
    "email_taken",
  );
}

export const onError: ErrorHandler = (err, c) => handleError(c, err);

function handleError(c: Context, err: unknown) {
  if (err instanceof HttpError) {
    const body: ErrorResponse = { error: err.message };
    if (err.code) body.code = err.code;
    return c.json(body, err.status as never);
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
