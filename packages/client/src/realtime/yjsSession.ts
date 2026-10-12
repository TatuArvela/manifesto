import { HocuspocusProvider } from "@hocuspocus/provider";
import { EDITOR_SCHEMA_VERSION, type NoteSealKey } from "@manifesto/shared";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  deleteReadableNoteCopies,
  LOCAL_COPY_PREFIX,
} from "./localNoteCopies.js";
import {
  joinSealedAwareness,
  joinSealedDocument,
  type SealedDocument,
} from "./sealedDocument.js";

/**
 * Every import of the collaboration stack (Yjs, Hocuspocus, y-indexeddb)
 * lives behind this module, which `yjsProvider` reaches only through a dynamic
 * `import()`. Open mode is the default build and can never open a socket, so
 * keeping these out of the entry chunk is what stops ~130 KB of collaboration
 * code from loading for every user who will never sync.
 *
 * Nothing here is a Preact hook: the module is a plain factory so that the
 * moment it arrives is the caller's problem, not a render-order constraint.
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
   * The note's key, which its shared document is sealed with. Null only
   * where sealing is handed through (a test of what sits above storage), and
   * then the document is synced as it is.
   */
  key: NoteSealKey | null;
  /** The keys the note was under before; see `joinSealedDocument`. */
  older?: ReadonlyMap<number, NoteSealKey> | undefined;
  /**
   * Our cursor label. The server replaces it with the account it authenticated
   * before anyone else sees it, so this only has to be right for this tab.
   */
  user: YjsSessionUser | null;
  onStatus: (status: YjsConnectionStatus) => void;
  onSynced: () => void;
  /** `reason` is `EDITOR_OUTDATED_REASON` when this build is too old to join. */
  onAuthenticationFailed: (reason: string) => void;
}

export interface YjsSession {
  ydoc: Y.Doc;
  awareness: Awareness | null;
  destroy: () => void;
}

/**
 * Opens one note's shared document. What the editor binds to (`ydoc`) is
 * readable and stays in this browser. What is synced to the server over the
 * Hocuspocus protocol, and mirrored into IndexedDB so an offline edit
 * survives a reload, is a second document that holds the first one's edits
 * sealed under the note's key (`sealedDocument.ts`): the server relays and
 * stores ciphertext, and so does this browser's offline copy. The note id is
 * the document name, and the server authorizes against that name rather than
 * the URL, so it is the one value that decides which document this
 * connection may touch.
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
  onAuthenticationFailed,
}: YjsSessionOptions): YjsSession {
  const wire = new Y.Doc();
  // One id for both documents, so "the client with the lowest id" is the
  // same client to everyone, whichever document they count in.
  const ydoc = key ? new Y.Doc() : wire;
  ydoc.clientID = wire.clientID;
  // A browser from before the document was sealed may still hold it
  // readable, under the old name. Whatever a copy holds is synced as it is,
  // so the sealed copy has a name of its own and the old ones are removed.
  void deleteReadableNoteCopies([noteId]);
  const idb = new IndexeddbPersistence(`${LOCAL_COPY_PREFIX}${noteId}`, wire);
  const sealed: SealedDocument | null = key
    ? joinSealedDocument({ noteId, key, older, inner: ydoc, outer: wire })
    : null;
  let compacting: ReturnType<typeof setInterval> | undefined;
  const provider = new HocuspocusProvider({
    // The server refuses an editor older than its own; see EDITOR_SCHEMA_VERSION.
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
      // Synced is a promise to the editor that the document it binds holds
      // what the server has: true only once every entry has been opened.
      void sealed.settled().then(() => {
        onSynced();
        void sealed.compact();
      });
    },
    onAuthenticationFailed: ({ reason }) => onAuthenticationFailed(reason),
  });

  // The editor's awareness is its own; what crosses the wire is each cursor
  // sealed, under the label the server stamps on it.
  const outer = provider.awareness ?? null;
  const awareness = key && outer ? new Awareness(ydoc) : outer;
  const leavePresence =
    key && outer && awareness
      ? joinSealedAwareness({ noteId, key, inner: awareness, outer })
      : null;
  if (user) awareness?.setLocalStateField("user", user);
  if (sealed) {
    // A long session gathers edits too, not only a fresh join.
    compacting = setInterval(() => void sealed.compact(), 60_000);
  }

  // A closing tab never runs the effect cleanup, so without this our cursor
  // lingers in everyone else's editor until the server times the socket out.
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
      // The last edits are still being sealed: the wire document, its
      // socket and its offline copy stay until they have been written.
      if (sealed) void sealed.destroy().then(close);
      else close();
    },
  };
}
