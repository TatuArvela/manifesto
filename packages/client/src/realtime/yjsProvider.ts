import { useEffect, useState } from "preact/hooks";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { loadYjsCollab } from "../extensions/yjsCollab.js";
import {
  authToken,
  currentUser,
  isServerMode,
  SERVER_URL,
} from "../state/auth.js";
import type { YjsConnectionStatus, YjsSession } from "./yjsSession.js";

export type { YjsConnectionStatus } from "./yjsSession.js";

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
 * { ydoc: null } when not in server mode or unauthenticated; the caller
 * should fall back to plain (non-collaborative) editing.
 *
 * The collaboration stack itself is fetched on demand (see `yjsSession`), so
 * the document appears one microtask-plus-a-network-fetch after the hook first
 * asks for it. `status` is `loading` for that window, and a chunk that fails to
 * arrive reports `disconnected` with no document, which lands the caller in
 * the same non-collaborative fallback as open mode rather than leaving an
 * editor waiting on a document that will never come.
 */
export function useNoteYDoc(noteId: string | null): NoteYDoc {
  const [state, setState] = useState<NoteYDoc>(IDLE);
  // Read the token via the value to make the dep array meaningful: token
  // rotation (login swap, server-forced logout) tears down the provider and
  // re-establishes the connection with the new credentials.
  const token = authToken.value;

  useEffect(() => {
    const url = wsUrl();
    if (!noteId || !isServerMode || !url || !token) {
      setState(IDLE);
      return;
    }

    let session: YjsSession | null = null;
    let cancelled = false;
    const user = currentUser.value;

    setState({ ...IDLE, status: "loading" });

    // Fetched alongside the session rather than when the editor asks for it:
    // the editor asks the instant we report `synced`, and fetching then would
    // leave the note body blank for a round trip. Fire and forget; the
    // editor awaits the same memoized promise.
    void loadYjsCollab().catch(() => {});

    import("./yjsSession.js").then(
      ({ createYjsSession }) => {
        if (cancelled) return;
        session = createYjsSession({
          url,
          noteId,
          token,
          user: user
            ? { id: user.id, name: user.displayName, color: user.avatarColor }
            : null,
          onStatus: (status) => {
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
        setState({
          ydoc: session.ydoc,
          awareness: session.awareness,
          status: "connecting",
          synced: false,
        });
      },
      () => {
        if (cancelled) return;
        setState({ ...IDLE, status: "disconnected" });
      },
    );

    return () => {
      cancelled = true;
      session?.destroy();
      setState(IDLE);
    };
  }, [noteId, token]);

  return state;
}
