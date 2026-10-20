import type {
  Note,
  NoteVersion,
  SealedNoteCreate,
  SealedNoteUpdate,
  SealedNoteVersionCreateRequest,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import type { NoteSealing } from "#/storage/sealing.ts";

/**
 * A sealing that seals nothing, for tests of the code above the storage layer.
 * A fake server in such a test answers with readable notes and reads readable
 * requests, as servers did before notes were sealed. Thus, the test stays about
 * the store, the socket or the screen for which it is. The real `Sealer` tests
 * what the seal itself does (`sealing.test.ts`,
 * `RestApiAdapter.sealed.test.ts`).
 */
export const plainSealing: NoteSealing = {
  unreadable: signal<ReadonlySet<string>>(new Set()),
  newer: signal<ReadonlySet<string>>(new Set()),
  due: signal<ReadonlySet<string>>(new Set()),
  replaced: signal<ReadonlyMap<string, number>>(new Map()),
  feedDue: signal<ReadonlySet<string>>(new Set()),
  feedKey: async () => "",
  rekey: async () => null,
  sealSeenKeys: async () => "",
  openSeenKeys: async () => new Map(),
  complete: true,
  markComplete: () => {},
  claimsImages: false,
  handsKeysOn: false,
  offerKey: async () => null,
  adoptOffered: async (_noteId, offered) => ({
    key: "",
    keyVersion: offered.keyVersion,
  }),
  openPreview: async (_noteId, _keyVersion, { title, content, font }) => ({
    title,
    content,
    font: font as Note["font"],
  }),
  sealUpload: async (image) => ({
    body: image,
    headers: { "Content-Type": image.type },
    key: null,
  }),
  keepImageKey: () => {},
  imageKeyOf: () => null,
  sameImage: () => {},
  openDownload: async (_ref, sealed) => sealed,
  open: async (sealed) => sealed as unknown as Note,
  openAll: async (sealed) => sealed as unknown as Note[],
  holds: () => true,
  missesOwnNotes: () => false,
  forget: () => {},
  sealNew: async (id, note) => ({ ...note, id }) as unknown as SealedNoteCreate,
  sealUpdate: async (_id, changes) => changes as unknown as SealedNoteUpdate,
  sealOver: async (id, note) =>
    ({ ...note, id }) as unknown as SealedNoteCreate,
  sealVersion: async (_noteId, version) =>
    version as unknown as SealedNoteVersionCreateRequest,
  openVersions: async (_noteId, sealed) => sealed as unknown as NoteVersion[],
  // No link key: the link is only its token.
  publish: async () => null,
  openLinkKey: async () => null,
  // No keys to carry. The server makes the token, as it does for a token that
  // reaches no note.
  newToken: async () => null,
  // No key: the shared document syncs as it is.
  documentKey: async () => null,
  sealComment: async (_noteId, _id, body) => ({ body, keyVersion: 1 }),
  openComments: async (_noteId, sealed) => sealed,
  sealPrefs: async (prefs) => prefs as Record<string, string | null>,
  openPrefs: async (sealed) => sealed,
};
