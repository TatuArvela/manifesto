import {
  ATTACHMENT_REF_PATTERN,
  MAX_IMAGES_PER_NOTE,
  MAX_LINK_PREVIEWS_PER_NOTE,
  MAX_PUBLIC_LINK_VIEWS,
  MAX_WRAPPED_KEY_LENGTH,
  OFFERED_KEY_MAX,
  PUBLIC_LINK_MODES,
  SEALED_FIELD_MAX,
  SHARE_ROLES,
} from "@manifesto/shared";
import { z } from "zod";
import { publicKey, sealed, wrappedKey } from "./fields.ts";

// The request bodies of sharing: shares and invitations, the keys that go with
// them, teams, and public links.

const shareRoleSchema = z.enum(SHARE_ROLES);

/**
 * A note key wrapped to the public key of a person and signed: only shapes,
 * because the server can open none of it. The client of the recipient checks
 * the signature against the key that it remembers for the signer.
 */
export const offeredKeySchema = z.object({
  keyVersion: z.number().int().min(1),
  ephemeral: publicKey,
  wrapped: sealed(OFFERED_KEY_MAX.wrapped),
  signer: z.string().min(1).max(64),
  signature: z
    .string()
    .min(1)
    .max(OFFERED_KEY_MAX.signature)
    .regex(/^[A-Za-z0-9_-]+$/, "Must be base64url"),
});

export const shareCreateSchema = z.object({
  userId: z.string().min(1).max(64),
  role: shareRoleSchema,
  key: offeredKeySchema.exactOptional(),
});

/**
 * `PUT /api/v1/auth/keys/seen/:userId`: the public keys of a person as this
 * account remembers them, sealed under its own key.
 */
export const seenKeySchema = z.object({ sealed: sealed(1024) });

/**
 * `POST /api/v1/invitations/:noteId/accept` and `PUT
 * /api/v1/notes/:id/held-key`.
 */
export const heldKeySchema = z.object({
  key: wrappedKey,
  keyVersion: z.number().int().min(1),
});

export const shareUpdateSchema = z.object({ role: shareRoleSchema });

const teamName = z.string().trim().min(1).max(100);
const teamMemberIds = z.array(z.string().min(1).max(64)).max(1000);

/** `POST /api/v1/admin/teams`. */
export const adminTeamCreateSchema = z.object({
  name: teamName,
  memberIds: teamMemberIds.exactOptional(),
});

/** `PUT /api/v1/admin/teams/:id`. */
export const adminTeamUpdateSchema = z
  .object({
    name: teamName.exactOptional(),
    memberIds: teamMemberIds.exactOptional(),
  })
  .refine((body) => body.name !== undefined || body.memberIds !== undefined, {
    message: "Nothing to change",
  });

/** `POST /api/v1/notes/:id/team-shares`. */
export const teamShareCreateSchema = z.object({
  teamId: z.string().min(1).max(64),
  role: shareRoleSchema,
});

/** `POST /api/v1/notes/:id/links`. */
export const publicLinkCreateSchema = z
  .object({
    mode: z.enum(PUBLIC_LINK_MODES),
    expiresInDays: z.number().int().min(1).max(3650).exactOptional(),
    password: z.string().min(1).max(256).exactOptional(),
    maxViews: z
      .number()
      .int()
      .min(1)
      .max(MAX_PUBLIC_LINK_VIEWS)
      .exactOptional(),
    // The link key, sealed for the owner. The server never has the key.
    sealedLinkKey: sealed(MAX_WRAPPED_KEY_LENGTH),
    // A live link: the note key, wrapped by the link key.
    wrappedKey: wrappedKey.exactOptional(),
    // A snapshot link: the current note, sealed for the link.
    snapshot: z
      .object({
        title: sealed(SEALED_FIELD_MAX.title),
        content: sealed(SEALED_FIELD_MAX.content),
        font: sealed(SEALED_FIELD_MAX.font),
        images: sealed(SEALED_FIELD_MAX.images),
        linkPreviews: sealed(SEALED_FIELD_MAX.linkPreviews),
        refs: z
          .array(z.string().regex(ATTACHMENT_REF_PATTERN))
          .max(MAX_IMAGES_PER_NOTE + MAX_LINK_PREVIEWS_PER_NOTE * 2),
        // The format of the words of the copy, as for a note.
        format: z.number().int().min(1).max(1_000_000).exactOptional(),
      })
      .exactOptional(),
  })
  .refine(
    (body) =>
      body.mode === "live"
        ? body.wrappedKey !== undefined && body.snapshot === undefined
        : body.snapshot !== undefined && body.wrappedKey === undefined,
    { message: "A live link takes wrappedKey, a snapshot link takes snapshot" },
  );

/** `POST /api/v1/public/:token/unlock`. */
export const publicLinkUnlockSchema = z.object({
  password: z.string().min(1).max(256),
});
