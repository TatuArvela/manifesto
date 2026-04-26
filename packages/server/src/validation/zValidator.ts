import type { Context } from "hono";
import type { z } from "zod";

type ValidatorResult =
  | { success: true; data: unknown }
  | { success: false; error: z.ZodError };

export function validatorHook(result: ValidatorResult, c: Context) {
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.length ? first.path.join(".") : undefined;
    const detail = first ? first.message : "Invalid request body";
    const error = path ? `${path}: ${detail}` : detail;
    return c.json({ error }, 422);
  }
}
