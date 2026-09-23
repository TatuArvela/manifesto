import { Hono, type MiddlewareHandler } from "hono";
import type { AuthProvider } from "../auth/types.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";

interface AttachmentDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  rateLimit?: MiddlewareHandler;
}

/**
 * `GET /api/attachments/:id`: an image a note refers to by `attachment:<id>`.
 * Readable by its owner and by anyone holding an accepted share of a note of
 * theirs that refers to it; to anyone else it does not exist.
 */
export function createAttachmentRoutes(deps: AttachmentDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
  routes.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) routes.use("*", deps.rateLimit);

  routes.get("/:id", async (c) => {
    const { userId } = c.get("auth");
    const id = c.req.param("id");
    if (!(await deps.storage.attachments.readableBy(id, userId))) {
      throw new HttpError(404, "Attachment not found");
    }
    const attachment = await deps.storage.attachments.get(id);
    if (!attachment) throw new HttpError(404, "Attachment not found");
    return c.body(new Uint8Array(attachment.data), 200, {
      "Content-Type": attachment.contentType,
      "Content-Length": String(attachment.size),
      // An id names one set of bytes for good, so a copy never goes stale.
      // Private: it was read with someone's credentials.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
  });

  return routes;
}
