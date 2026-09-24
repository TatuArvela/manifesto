import type {
  AdminCreateUserRequest,
  AdminUpdateUserRequest,
  ApiTokenCreateRequest,
  AuthMeUpdateRequest,
  NoteCreate,
  NotesImportRequest,
  NoteUpdate,
  NoteVersionCreateRequest,
  PasswordChangeRequest,
  RegisterRequest,
  ShareCreateRequest,
  ShareUpdateRequest,
  WebhookCreateRequest,
} from "@manifesto/shared";
import type { z } from "zod";
import type {
  adminCreateUserSchema,
  adminUpdateUserSchema,
  apiTokenCreateSchema,
  authMeUpdateSchema,
  noteCreateSchema,
  notesImportSchema,
  noteUpdateSchema,
  noteVersionCreateSchema,
  passwordChangeSchema,
  registerSchema,
  shareCreateSchema,
  shareUpdateSchema,
  webhookCreateSchema,
} from "./schemas.js";

/**
 * The request bodies are declared twice: as TypeScript types in
 * `@manifesto/shared`, which the client builds requests from, and as the zod
 * schemas here, which the server validates them with. This file holds the two
 * together at compile time: if either side gains, loses or retypes a field,
 * the typecheck fails here rather than a request failing at runtime.
 */

/** True when each type is assignable to the other. */
type Matches<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Assert<T extends true> = T;

type Body<S extends z.ZodType> = z.input<S>;

// `trashedAt` is stamped by the server and deliberately not accepted.
type NoteBody = Omit<NoteCreate, "trashedAt">;

export type WireTypeChecks = [
  Assert<Matches<Body<typeof noteCreateSchema>, NoteBody>>,
  Assert<
    Matches<
      Body<typeof noteUpdateSchema>,
      Omit<NoteUpdate, "trashedAt" | "updatedAt">
    >
  >,
  Assert<
    Matches<
      Body<typeof notesImportSchema>["notes"][number],
      Omit<NotesImportRequest["notes"][number], "trashedAt">
    >
  >,
  Assert<
    Matches<Body<typeof noteVersionCreateSchema>, NoteVersionCreateRequest>
  >,
  Assert<Matches<Body<typeof apiTokenCreateSchema>, ApiTokenCreateRequest>>,
  Assert<Matches<Body<typeof webhookCreateSchema>, WebhookCreateRequest>>,
  Assert<Matches<Body<typeof registerSchema>, RegisterRequest>>,
  Assert<Matches<Body<typeof authMeUpdateSchema>, AuthMeUpdateRequest>>,
  Assert<Matches<Body<typeof passwordChangeSchema>, PasswordChangeRequest>>,
  Assert<Matches<Body<typeof adminCreateUserSchema>, AdminCreateUserRequest>>,
  Assert<Matches<Body<typeof adminUpdateUserSchema>, AdminUpdateUserRequest>>,
  Assert<Matches<Body<typeof shareCreateSchema>, ShareCreateRequest>>,
  Assert<Matches<Body<typeof shareUpdateSchema>, ShareUpdateRequest>>,
];
