import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "preact/hooks";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  authToken,
  currentUser,
  isServerMode,
  SERVER_URL,
} from "../state/auth.js";

export type YjsConnectionStatus =
  | "disabled"
  | "loading"
  | "connecting"
  | "connected"
  | "disconnected";

export interface NoteYDoc {
  ydoc: Y.Doc | null;
  awareness: Awareness | null;
  status: YjsConnectionStatus;
  /**
   * True once the server's state has been merged into the local doc. Callers
   * must not bind an editor before this: `ySyncPlugin` adopts whatever the
   * shared fragment holds, so binding early shows an empty document and then
   * writes that emptiness back as the note's content.
   */
  synced: boolean;
}

const IDLE: NoteYDoc = {
  ydoc: null,
  awareness: null,
  status: "disabled",
  synced: false,
};

function wsUrl(): string | null {
  if (!SERVER_URL) return null;
  return `${SERVER_URL.replace(/^http/, "ws")}/api/yjs`;
}

/**
 * Returns a Y.Doc bound to the given note id, with WebSocket sync to the
 * server and IndexedDB persistence for offline buffering. Returns
 * { ydoc: null } when not in server mode or unauthenticated — the caller
 * should fall back to plain (non-collaborative) editing.
 *
 * The note id is the Hocuspocus document name, and the server authorizes
 * against that name rather than against the URL, so it is the one value that
 * decides which document this connection may touch.
 */
export function useNoteYDoc(noteId: string | null): NoteYDoc {
  const [state, setState] = useState<NoteYDoc>(IDLE);
  // Read the token via the value to make the dep array meaningful — token
  // rotation (login swap, server-forced logout) tears down the provider and
  // re-establishes the connection with the new credentials.
  const token = authToken.value;

  useEffect(() => {
    const url = wsUrl();
    if (!noteId || !isServerMode || !url || !token) {
      setState(IDLE);
      return;
    }

    const ydoc = new Y.Doc();
    const idb = new IndexeddbPersistence(`manifesto:yjs:${noteId}`, ydoc);
    const provider = new HocuspocusProvider({
      url,
      name: noteId,
      document: ydoc,
      token,
      onStatus: ({ status }) => {
        setState((prev) => ({ ...prev, status }));
      },
      onSynced: () => {
        setState((prev) => ({ ...prev, synced: true }));
      },
      onAuthenticationFailed: () => {
        setState((prev) => ({
          ...prev,
          status: "disconnected",
          synced: false,
        }));
      },
    });

    const user = currentUser.value;
    if (user) {
      provider.awareness?.setLocalStateField("user", {
        id: user.id,
        name: user.displayName,
        color: user.avatarColor,
      });
    }
    const onPageHide = () => {
      provider.awareness?.setLocalState(null);
    };
    window.addEventListener("pagehide", onPageHide);

    setState({
      ydoc,
      awareness: provider.awareness,
      status: "connecting",
      synced: false,
    });

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      provider.awareness?.setLocalState(null);
      provider.destroy();
      idb.destroy();
      ydoc.destroy();
      setState(IDLE);
    };
  }, [noteId, token]);

  return state;
}
