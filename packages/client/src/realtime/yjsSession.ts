import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

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
  /** Published to other clients as the cursor label; null leaves us anonymous. */
  user: YjsSessionUser | null;
  onStatus: (status: YjsConnectionStatus) => void;
  onSynced: () => void;
  onAuthenticationFailed: () => void;
}

export interface YjsSession {
  ydoc: Y.Doc;
  awareness: Awareness | null;
  destroy: () => void;
}

/**
 * Opens one note's shared document: a `Y.Doc` synced to the server over the
 * Hocuspocus protocol and mirrored into IndexedDB so an offline edit survives
 * a reload. The note id is the document name, and the server authorizes
 * against that name rather than the URL, so it is the one value that decides
 * which document this connection may touch.
 */
export function createYjsSession({
  url,
  noteId,
  token,
  user,
  onStatus,
  onSynced,
  onAuthenticationFailed,
}: YjsSessionOptions): YjsSession {
  const ydoc = new Y.Doc();
  const idb = new IndexeddbPersistence(`manifesto:yjs:${noteId}`, ydoc);
  const provider = new HocuspocusProvider({
    url,
    name: noteId,
    document: ydoc,
    token,
    onStatus: ({ status }) => onStatus(status),
    onSynced: () => onSynced(),
    onAuthenticationFailed: () => onAuthenticationFailed(),
  });

  if (user) {
    provider.awareness?.setLocalStateField("user", user);
  }

  // A closing tab never runs the effect cleanup, so without this our cursor
  // lingers in everyone else's editor until the server times the socket out.
  const onPageHide = () => {
    provider.awareness?.setLocalState(null);
  };
  window.addEventListener("pagehide", onPageHide);

  return {
    ydoc,
    awareness: provider.awareness ?? null,
    destroy: () => {
      window.removeEventListener("pagehide", onPageHide);
      provider.awareness?.setLocalState(null);
      provider.destroy();
      idb.destroy();
      ydoc.destroy();
    },
  };
}
