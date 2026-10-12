import type {
  Note,
  NoteVersion,
  SealedNoteCreate,
  SealedNoteUpdate,
  SealedNoteVersionCreateRequest,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import type { NoteSealing } from "../storage/sealing.js";

/**
 * Sealing that seals nothing, for tests of what sits above the storage
 * layer: a fake server in such a test answers with readable notes and reads
 * readable requests, as servers did before notes were sealed, and the test
 * stays about the store, the socket or the screen it is for. What sealing
 * itself does is tested with the real `Sealer` (`sealing.test.ts`,
 * `RestApiAdapter.sealed.test.ts`).
 */
export const plainSealing: NoteSealing = {
  unreadable: signal<ReadonlySet<string>>(new Set()),
  complete: true,
  markComplete: () => {},
  claimsImages: false,
  handsKeysOn: false,
  offerKey: async () => null,
  adoptOffered: async (_noteId, offered) => ({
    key: "",
    keyVersion: offered.keyVersion,
  }),
  openPreview: async (_noteId, _keyVersion, sealed) =>
    sealed as unknown as Pick<Note, "title" | "content" | "font">,
  sealUpload: async (image) => ({
    body: image,
    headers: { "Content-Type": image.type },
    key: null,
  }),
  keepImageKey: () => {},
  sameImage: () => {},
  openDownload: async (_ref, sealed) => sealed,
  open: async (sealed) => sealed as unknown as Note,
  openAll: async (sealed) => sealed as unknown as Note[],
  holds: () => true,
  forget: () => {},
  sealNew: async (_id, note) => note as unknown as SealedNoteCreate,
  sealUpdate: async (_id, changes) => changes as unknown as SealedNoteUpdate,
  sealOver: async (id, note) =>
    ({ ...note, id }) as unknown as SealedNoteCreate,
  sealVersion: async (_noteId, version) =>
    version as unknown as SealedNoteVersionCreateRequest,
  openVersions: async (_noteId, sealed) => sealed as unknown as NoteVersion[],
  sealComment: async (_noteId, _id, body) => ({ body, keyVersion: 1 }),
  openComments: async (_noteId, sealed) => sealed,
  sealPrefs: async (prefs) => prefs as Record<string, string | null>,
  openPrefs: async (sealed) => sealed,
};
