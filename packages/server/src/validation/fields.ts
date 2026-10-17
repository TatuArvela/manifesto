import {
  isCiphertext,
  MAX_WRAPPED_KEY_LENGTH,
  PUBLIC_KEY_LENGTH,
} from "@manifesto/shared";
import { z } from "zod";

// The pieces the request schemas are built from: a sealed value, an id the
// client chose, a key, and the password that confirms an action.

/**
 * Every field of `shape`, made optional the way a JSON body is: a key that is
 * absent, never one that is present and `undefined`. `.partial()` gives the
 * second, which the wire types in `@manifesto/shared` do not allow.
 */
export function exactPartial<T extends z.ZodRawShape>(
  shape: T,
): { [K in keyof T]: z.ZodExactOptional<T[K]> } {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [key, z.exactOptional(field)]),
  ) as { [K in keyof T]: z.ZodExactOptional<T[K]> };
}

/** The password that confirms an action, where the account has one (see
 * `auth/confirmation.ts`). Only compared with the stored hash. */
export const confirmationPassword = z.string().max(256).exactOptional();

/**
 * A value sealed in the browser: a ciphertext by its shape, which is all the
 * server can say about one. Anything else in its place is refused, so a
 * faulty client cannot store readable text where a ciphertext belongs.
 */
export const sealed = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => isCiphertext(value, max), {
      message: "Must be a ciphertext",
    });

/** An id chosen by the client that seals what it names: a note's, a
 * version's, a comment's. */
export const noteIdSchema = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/);

/** A sealed value, or nothing where one was never set. */
export const sealedOrEmpty = (max: number) =>
  z.union([z.literal(""), sealed(max)]);

/**
 * A wrapped key: a ciphertext by its shape, which is all the server can say
 * about one. Anything else in its place is refused, so a faulty client cannot
 * store a key where a wrapped key belongs.
 */
export const wrappedKey = sealed(MAX_WRAPPED_KEY_LENGTH);

/** An uncompressed P-256 point as base64url: 65 bytes, the first of them 4. */
export const publicKey = z
  .string()
  .length(PUBLIC_KEY_LENGTH)
  .regex(/^B[A-Za-z0-9_-]+$/, "Must be a P-256 public key");
