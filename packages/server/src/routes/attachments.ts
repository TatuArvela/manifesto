import { zValidator } from "@hono/zod-validator";
import {
  ATTACHMENT_REF_PREFIX,
  type AttachmentsClaimResponse,
  type AttachmentUploadResponse,
  IMAGE_ADDRESS_PATTERN,
  MAX_IMAGE_SOURCE_BYTES,
  SEALED_IMAGE_OVERHEAD,
} from "@manifesto/shared";
import { Hono } from "hono";
import { adoptImages } from "../attachments/store.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { attachmentsClaimSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

interface AttachmentDeps {
  storage: StorageDriver;
}

/** What a sealed image is stored and served as: bytes of no stated kind. */
const SEALED_TYPE = "application/octet-stream";

/**
 * `/api/attachments`: the images notes refer to as `attachment:<id>`, each
 * sealed in the browser before it arrives. The server stores bytes it cannot
 * read, and no longer says what kind of image one is: the note that names it
 * does, sealed, and the client that opens it checks.
 *
 * `POST /` uploads one, as the sealed bytes with the address the uploader
 * finds it by in `X-Attachment-Address`, and answers the reference to put in
 * a note's `images`. It is stored under the uploader, once for an address.
 *
 * `POST /claim` makes images the owner's of the note they are about to be
 * named in: a note's attachments all belong to its owner, whose notes they
 * are swept with, and a sealed note cannot have a reference rewritten under
 * it as a readable one could. See `adoptImages`.
 *
 * `GET /:id` serves one to its owner and to anyone holding an accepted share
 * of a note of theirs that refers to it; to anyone else it does not exist.
 */
export function createAttachmentRoutes(deps: AttachmentDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();

  routes.post("/", async (c) => {
    const { userId } = c.get("auth");
    const address = c.req.header("X-Attachment-Address") ?? "";
    if (!IMAGE_ADDRESS_PATTERN.test(address)) {
      throw new HttpError(422, "X-Attachment-Address names no sealed image");
    }
    const data = Buffer.from(await c.req.arrayBuffer());
    if (data.length <= SEALED_IMAGE_OVERHEAD) {
      throw new HttpError(422, "The file is empty");
    }
    if (data.length > MAX_IMAGE_SOURCE_BYTES + SEALED_IMAGE_OVERHEAD) {
      throw new HttpError(413, "The image is too large");
    }
    const stored = await deps.storage.attachments.put({
      id: newId(),
      ownerId: userId,
      // The column that held a hash of the bytes holds the uploader's
      // address for them: an HMAC of the image under a key of theirs.
      sha256: address,
      contentType: SEALED_TYPE,
      data,
      createdAt: nowIso(),
    });
    const body: AttachmentUploadResponse = {
      ref: `${ATTACHMENT_REF_PREFIX}${stored.id}`,
    };
    return c.json(body, 201);
  });

  routes.post(
    "/claim",
    zValidator("json", attachmentsClaimSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const { noteId, refs } = c.req.valid("json");
      let ownerId = userId;
      if (noteId !== undefined) {
        // A note about to be made has no owner yet but its maker.
        const access = await deps.storage.notes.access(noteId, userId);
        if (access?.role === "view") {
          throw new HttpError(
            403,
            "Your role on this note does not allow changing images",
          );
        }
        if (access) ownerId = access.ownerId;
        else if (await deps.storage.notes.exists(noteId)) {
          throw new HttpError(404, "Note not found");
        }
      }
      const body: AttachmentsClaimResponse = {
        refs: await adoptImages(deps.storage, refs, ownerId, userId, nowIso()),
      };
      return c.json(body);
    },
  );

  routes.get("/:id", async (c) => {
    const { userId } = c.get("auth");
    const id = c.req.param("id");
    if (!(await deps.storage.attachments.readableBy(id, userId))) {
      throw new HttpError(404, "Attachment not found");
    }
    const attachment = await deps.storage.attachments.get(id);
    if (!attachment) throw new HttpError(404, "Attachment not found");
    return c.body(new Uint8Array(attachment.data), 200, {
      "Content-Type": SEALED_TYPE,
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
