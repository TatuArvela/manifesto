import { zValidator } from "@hono/zod-validator";
import {
  type AccountSealKeys,
  ATTACHMENT_REF_PREFIX,
  type AttachmentsClaimResponse,
  type AttachmentUploadResponse,
  IMAGE_ADDRESS_PATTERN,
  type ImageKey,
  MAX_IMAGE_SOURCE_BYTES,
  openImage,
  openSealedNote,
  SEALED_IMAGE_OVERHEAD,
  sealImageAtRandom,
  unwrapImageKey,
  wrapImageKey,
} from "@manifesto/shared";
import { type Context, Hono } from "hono";
import { adoptImages } from "#/attachments/store.ts";
import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { attachmentsClaimSchema } from "#/validation/noteSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import { tokenKeys } from "./noteCodec.ts";

type Ctx = Context<{ Variables: { auth: AuthContext } }>;

interface AttachmentDeps {
  storage: StorageDriver;
}

/** What a sealed image is stored and served as: bytes of no stated kind. */
const SEALED_TYPE = "application/octet-stream";

/**
 * `/api/v1/attachments`: the images notes refer to as `attachment:<id>`, each
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
 *
 * A token that carries keys sends and is sent the image itself: the server
 * seals what it uploads and opens what it reads, for that request, as it
 * does a note's words (`noteCodec.ts`).
 */
export function createAttachmentRoutes(deps: AttachmentDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();

  /**
   * An image from a token that carries keys: sent as it is, since a script
   * cannot seal one, and sealed here under a key made for it. The key is
   * kept with the attachment, wrapped under the account's notes key, until
   * a note names the image and takes the key into its own sealed list.
   */
  async function uploadedByToken(c: Ctx, keys: AccountSealKeys) {
    const image = new Uint8Array(await c.req.arrayBuffer());
    if (image.length === 0) throw new HttpError(422, "The file is empty");
    if (image.length > MAX_IMAGE_SOURCE_BYTES) {
      throw new HttpError(413, "The image is too large");
    }
    const sealed = await sealImageAtRandom(image);
    if (!sealed) {
      throw new HttpError(415, "Not a PNG, JPEG, GIF, WebP or AVIF image");
    }
    const id = newId();
    await deps.storage.attachments.put({
      id,
      ownerId: keys.userId,
      sha256: sealed.address,
      contentType: SEALED_TYPE,
      data: Buffer.from(sealed.bytes),
      createdAt: nowIso(),
      wrappedKey: await wrapImageKey(keys, id, sealed.key),
    });
    const body: AttachmentUploadResponse = {
      ref: `${ATTACHMENT_REF_PREFIX}${id}`,
    };
    return c.json(body, 201);
  }

  /**
   * What opens an image for a token: the key kept with one it uploaded, or
   * the key the note it names holds for it. A token has to say which note,
   * since the keys of a note's images are inside the note.
   */
  async function keyFor(
    keys: AccountSealKeys,
    id: string,
    wrappedKey: string | null,
    noteId: string | undefined,
  ): Promise<ImageKey> {
    const own = await unwrapImageKey(keys, id, wrappedKey);
    if (own) return own;
    if (noteId === undefined) {
      throw new HttpError(
        400,
        "Say which note the image is in: ?note=<note id>",
      );
    }
    const note = await deps.storage.notes.getById(noteId, keys.userId);
    const opened = note ? await openSealedNote(keys, note) : null;
    const key = opened?.imageKeys.get(`${ATTACHMENT_REF_PREFIX}${id}`);
    if (!key) throw new HttpError(404, "Attachment not found");
    return key;
  }

  routes.post("/", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    if (keys) return uploadedByToken(c, keys);
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
    const keys = tokenKeys(c);
    if (keys) {
      // Opened for the token, which cannot: the image itself, as the kind
      // its note says it is and its bytes agree it is.
      const key = await keyFor(
        keys,
        id,
        attachment.wrappedKey,
        c.req.query("note"),
      );
      const image = await openImage(key, new Uint8Array(attachment.data));
      if (!image) throw new HttpError(404, "Attachment not found");
      return c.body(image, 200, {
        "Content-Type": key.type,
        "Content-Length": String(image.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
    }
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
