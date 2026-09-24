import { createHash } from "node:crypto";
import {
  ATTACHMENT_REF_PREFIX,
  type AttachmentUploadResponse,
  MAX_IMAGE_SOURCE_BYTES,
} from "@manifesto/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { sniffImageType } from "../attachments/sniff.js";
import type { AuthProvider } from "../auth/types.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
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
 * `/api/attachments`: the images notes refer to as `attachment:<id>`.
 *
 * `POST /` uploads one, as the raw file with its type in `Content-Type`, and
 * answers the reference to put in a note's `images`. It is stored under the
 * uploader, deduplicated by content; attaching it to someone else's note
 * copies it to that note's owner (see `attachments/store.ts`).
 *
 * `GET /:id` serves one to its owner and to anyone holding an accepted share
 * of a note of theirs that refers to it; to anyone else it does not exist.
 */
export function createAttachmentRoutes(deps: AttachmentDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
  routes.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) routes.use("*", deps.rateLimit);

  routes.post("/", async (c) => {
    const { userId } = c.get("auth");
    const declared = (c.req.header("Content-Type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase()
      .replace("image/jpg", "image/jpeg");
    const data = Buffer.from(await c.req.arrayBuffer());
    if (data.length === 0) throw new HttpError(422, "The file is empty");
    if (data.length > MAX_IMAGE_SOURCE_BYTES) {
      throw new HttpError(413, "The image is too large");
    }
    const actual = sniffImageType(data);
    if (!actual || actual !== declared) {
      throw new HttpError(
        415,
        "Upload a PNG, JPEG, GIF, WebP or AVIF image, sent as its own type",
      );
    }
    const stored = await deps.storage.attachments.put({
      id: newId(),
      ownerId: userId,
      sha256: createHash("sha256").update(data).digest("hex"),
      contentType: actual,
      data,
      createdAt: nowIso(),
    });
    const body: AttachmentUploadResponse = {
      ref: `${ATTACHMENT_REF_PREFIX}${stored.id}`,
    };
    return c.json(body, 201);
  });

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
