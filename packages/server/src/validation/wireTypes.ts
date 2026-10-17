import type {
  AccountKeysSetupRequest,
  AdminCreateUserRequest,
  AdminUpdateUserRequest,
  ApiTokenCreateRequest,
  AttachmentsClaimRequest,
  AuthMeUpdateRequest,
  HeldKeyRequest,
  NoteCreate,
  NoteRekeyRequest,
  NotesImportRequest,
  NoteUpdate,
  NoteVersionCreateRequest,
  PasswordChangeRequest,
  RecoveryCompleteRequest,
  RecoveryKeyReplaceRequest,
  RecoveryOpenRequest,
  RegisterRequest,
  SealedAccountPrefsUpdate,
  SealedNoteCreate,
  SealedNoteImport,
  SealedNoteUpdate,
  SealedNoteVersionCreateRequest,
  SecretKeyReplaceRequest,
  SeenKeyRequest,
  ShareCreateRequest,
  ShareUpdateRequest,
  WebhookCreateRequest,
} from "@manifesto/shared";
import type { z } from "zod";
import type {
  apiTokenCreateSchema,
  webhookCreateSchema,
} from "./accessSchemas.ts";
import type {
  accountKeysSetupSchema,
  accountPrefsUpdateSchema,
  adminCreateUserSchema,
  adminUpdateUserSchema,
  authMeUpdateSchema,
  passwordChangeSchema,
  recoveryCompleteSchema,
  recoveryKeyReplaceSchema,
  recoveryOpenSchema,
  registerSchema,
  secretKeyReplaceSchema,
} from "./accountSchemas.ts";
import type {
  attachmentsClaimSchema,
  noteCreateSchema,
  noteRekeySchema,
  notesImportSchema,
  noteUpdateSchema,
  noteVersionCreateSchema,
  sealedNoteCreateSchema,
  sealedNotesImportSchema,
  sealedNoteUpdateSchema,
  sealedVersionCreateSchema,
} from "./noteSchemas.ts";
import type {
  heldKeySchema,
  seenKeySchema,
  shareCreateSchema,
  shareUpdateSchema,
} from "./sharingSchemas.ts";

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
  Assert<
    Matches<
      Body<typeof sealedNoteCreateSchema>,
      Omit<SealedNoteCreate, "trashedAt">
    >
  >,
  Assert<
    Matches<
      Body<typeof sealedNoteUpdateSchema>,
      Omit<SealedNoteUpdate, "trashedAt" | "updatedAt" | "key">
    >
  >,
  Assert<Matches<Body<typeof noteRekeySchema>, NoteRekeyRequest>>,
  Assert<Matches<Body<typeof seenKeySchema>, SeenKeyRequest>>,
  Assert<
    Matches<
      Body<typeof sealedNotesImportSchema>["notes"][number],
      Omit<SealedNoteImport, "trashedAt">
    >
  >,
  Assert<
    Matches<
      Body<typeof sealedVersionCreateSchema>,
      SealedNoteVersionCreateRequest
    >
  >,
  Assert<
    Matches<Body<typeof accountPrefsUpdateSchema>, SealedAccountPrefsUpdate>
  >,
  Assert<Matches<Body<typeof attachmentsClaimSchema>, AttachmentsClaimRequest>>,
  Assert<Matches<Body<typeof apiTokenCreateSchema>, ApiTokenCreateRequest>>,
  Assert<Matches<Body<typeof webhookCreateSchema>, WebhookCreateRequest>>,
  Assert<Matches<Body<typeof registerSchema>, RegisterRequest>>,
  Assert<Matches<Body<typeof authMeUpdateSchema>, AuthMeUpdateRequest>>,
  Assert<Matches<Body<typeof passwordChangeSchema>, PasswordChangeRequest>>,
  Assert<Matches<Body<typeof adminCreateUserSchema>, AdminCreateUserRequest>>,
  Assert<Matches<Body<typeof adminUpdateUserSchema>, AdminUpdateUserRequest>>,
  Assert<Matches<Body<typeof shareCreateSchema>, ShareCreateRequest>>,
  Assert<Matches<Body<typeof shareUpdateSchema>, ShareUpdateRequest>>,
  Assert<Matches<Body<typeof heldKeySchema>, HeldKeyRequest>>,
  Assert<Matches<Body<typeof accountKeysSetupSchema>, AccountKeysSetupRequest>>,
  Assert<Matches<Body<typeof secretKeyReplaceSchema>, SecretKeyReplaceRequest>>,
  Assert<
    Matches<Body<typeof recoveryKeyReplaceSchema>, RecoveryKeyReplaceRequest>
  >,
  Assert<Matches<Body<typeof recoveryOpenSchema>, RecoveryOpenRequest>>,
  Assert<Matches<Body<typeof recoveryCompleteSchema>, RecoveryCompleteRequest>>,
];
