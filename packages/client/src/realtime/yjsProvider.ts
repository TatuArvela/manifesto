import { useEffect, useState } from "preact/hooks";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { authToken, isServerMode, SERVER_URL } from "../state/auth.js";

const SUBPROTOCOL = "manifesto-session";

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
}

const IDLE: NoteYDoc = { ydoc: null, awareness: null, status: "disabled" };

function wsBaseUrl(): string | null {
  if (!SERVER_URL) return null;
  return SERVER_URL.replace(/^http/, "ws");
}

/**
 * Returns a Y.Doc bound to the given note id, with WebSocket sync to the
 * server and IndexedDB persistence for offline buffering. Returns
 * { ydoc: null } when not in server mode or unauthenticated — the caller
 * should fall back to plain (non-collaborative) editing.
 */
export function useNoteYDoc(noteId: string | null): NoteYDoc {
  const [state, setState] = useState<NoteYDoc>(IDLE);

  useEffect(() => {
    const wsBase = wsBaseUrl();
    const token = authToken.value;
    if (!noteId || !isServerMode || !wsBase || !token) {
      setState(IDLE);
      return;
    }

    const ydoc = new Y.Doc();
    const idb = new IndexeddbPersistence(`manifesto:yjs:${noteId}`, ydoc);
    const provider = new WebsocketProvider(
      wsBase,
      `api/yjs/notes/${noteId}`,
      ydoc,
      {
        protocols: [SUBPROTOCOL, token],
      },
    );

    setState({ ydoc, awareness: provider.awareness, status: "connecting" });

    const onStatus = (event: { status: string }) => {
      setState((prev) => ({
        ...prev,
        status:
          event.status === "connected"
            ? "connected"
            : event.status === "connecting"
              ? "connecting"
              : "disconnected",
      }));
    };
    provider.on("status", onStatus);

    return () => {
      provider.off("status", onStatus);
      provider.disconnect();
      provider.destroy();
      idb.destroy();
      ydoc.destroy();
      setState(IDLE);
    };
  }, [noteId]);

  return state;
}
