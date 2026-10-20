import { HocuspocusProvider } from "@hocuspocus/provider";
import { EDITOR_SCHEMA_VERSION, type NoteSealKey } from "@manifesto/shared";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  deleteReadableNoteCopies,
  LOCAL_COPY_PREFIX,
} from "./localNoteCopies.ts";
import {
  joinSealedAwareness,
  joinSealedDocument,
  type SealedDocument,
} from "./sealedDocument.ts";

/**
 * All imports of the collaboration stack (Yjs, Hocuspocus, y-indexeddb) are
 * behind this module. `yjsProvider` reaches it only through a dynamic
 * `import()`. Open mode is the default build and can never open a socket. Thus,
 * when these are out of the entry chunk, approximately 130 KB of collaboration
 * code does not load for each user who will never sync.
 *
 * Nothing here is a Preact hook. The module is a plain factory. Thus, the
 * moment when it arrives is a problem for the caller, not a constraint on the
 * render order.
 */

export type YjsConnectionStatus =
  | "disabled"
  | "loading"
  | "connecting"
  | "connected"
  | "disconnected";

export interface YjsSessionUser {
  id: string;
  name: string;
  color: string;
}

export interface YjsSessionOptions {
  url: string;
  noteId: string;
  token: string;
  /**
   * The key of the note, with which its shared document is sealed. Null only
   * where the seal is skipped (a test of the code above storage). Then the
   * document syncs as it is.
   */
  key: NoteSealKey | null;
  /** The previous keys of the note. See `joinSealedDocument`. */
  older?: ReadonlyMap<number, NoteSealKey> | undefined;
  /**
   * Our cursor label. The server replaces it with the authenticated account
   * before any other person sees it. Thus, it only has to be correct for this
   * tab.
   */
  user: YjsSessionUser | null;
  onStatus: (status: YjsConnectionStatus) => void;
  onSynced: () => void;
  /**
   * Entries of the document did not open here, `count` of them so far. The
   * editor shows the others, and tells that it is not everything.
   */
  onUnreadable: (count: number) => void;
  /**
   * `reason` is `EDITOR_OUTDATED_REASON` when this build is too old to join.
   */
  onAuthenticationFailed: (reason: string) => void;
}

export interface YjsSession {
  ydoc: Y.Doc;
  awareness: Awareness | null;
  destroy: () => void;
}

/**
 * Opens the shared document of one note. The editor binds to a readable
 * document (`ydoc`) that stays in this browser. A second document syncs to the
 * server over the Hocuspocus protocol, and is mirrored into IndexedDB so that
 * an offline edit stays after a reload. It contains the edits of the first
 * document, sealed under the key of the note (`sealedDocument.ts`). The server
 * relays and stores ciphertext, and so does the offline copy of this browser.
 * The note id is the document name, and the server authorizes against that
 * name, not against the URL. Thus, it is the one value that decides which
 * document this connection can change.
 */
export function createYjsSession({
  url,
  noteId,
  token,
  key,
  older,
  user,
  onStatus,
  onSynced,
  onUnreadable,
  onAuthenticationFailed,
}: YjsSessionOptions): YjsSession {
  const wire = new Y.Doc();
  // One id for both documents. Thus, "the client with the lowest id" is the
  // same client for all persons, whichever document they count in.
  const ydoc = key ? new Y.Doc() : wire;
  ydoc.clientID = wire.clientID;
  // A browser from before the document was sealed can still have it readable,
  // under the old name. The content of a copy syncs as it is. Thus, the sealed
  // copy has its own name, and the old copies are removed.
  void deleteReadableNoteCopies([noteId]);
  const idb = new IndexeddbPersistence(`${LOCAL_COPY_PREFIX}${noteId}`, wire);
  const sealed: SealedDocument | null = key
    ? joinSealedDocument({
        noteId,
        key,
        older,
        inner: ydoc,
        outer: wire,
        onUnreadable,
      })
    : null;
  let compacting: ReturnType<typeof setInterval> | undefined;
  const provider = new HocuspocusProvider({
    // The server refuses an editor older than its own. See
    // EDITOR_SCHEMA_VERSION.
    url: `${url}?editor=${EDITOR_SCHEMA_VERSION}`,
    name: noteId,
    document: wire,
    token,
    onStatus: ({ status }) => onStatus(status),
    onSynced: () => {
      if (!sealed) {
        onSynced();
        return;
      }
      // Synced is a promise to the editor that the document to which it binds
      // contains what the server has. True only after each entry opened.
      void sealed.settled().then(() => {
        onSynced();
        void sealed.compact();
      });
    },
    onAuthenticationFailed: ({ reason }) => onAuthenticationFailed(reason),
  });

  // The awareness of the editor is its own. Each cursor goes across the wire
  // sealed, under the label that the server adds to it.
  const outer = provider.awareness ?? null;
  const awareness = key && outer ? new Awareness(ydoc) : outer;
  const leavePresence =
    key && outer && awareness
      ? joinSealedAwareness({ noteId, key, inner: awareness, outer })
      : null;
  if (user) awareness?.setLocalStateField("user", user);
  if (sealed) {
    // A long session also collects edits, not only a new join.
    compacting = setInterval(() => void sealed.compact(), 60_000);
  }

  // A tab that closes never runs the cleanup of the effect. Thus, without this,
  // our cursor stays in the editors of all other persons until the server times
  // out the socket.
  const onPageHide = () => {
    outer?.setLocalState(null);
  };
  window.addEventListener("pagehide", onPageHide);

  return {
    ydoc,
    awareness,
    destroy: () => {
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(compacting);
      leavePresence?.();
      outer?.setLocalState(null);
      if (awareness !== outer) awareness?.destroy();
      const close = () => {
        provider.destroy();
        void idb.destroy();
        if (ydoc !== wire) ydoc.destroy();
        wire.destroy();
      };
      // The last edits are still in their seal. The wire document, its socket
      // and its offline copy stay until they are written.
      if (sealed) void sealed.destroy().then(close);
      else close();
    },
  };
}
