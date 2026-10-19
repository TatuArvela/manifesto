import { EDITOR_OUTDATED_REASON } from "@manifesto/shared";
import { useEffect, useState } from "preact/hooks";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { loadYjsCollab } from "#/extensions/yjsCollab.ts";
import {
  authToken,
  currentUser,
  isServerMode,
  WS_ORIGIN,
} from "#/state/account/auth.ts";
import { sealer } from "#/storage/sealing.ts";
import { sealedNote } from "#/storage/shareKeys.ts";
import type { YjsConnectionStatus, YjsSession } from "./yjsSession.ts";

export type { YjsConnectionStatus } from "./yjsSession.ts";

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
  /**
   * The server refused this build's editor as older than its own. Editing the
   * text any other way would write this build's reading of the note over
   * content it may not understand, so the caller locks the text and asks for
   * a reload.
   */
  outdated: boolean;
  /**
   * How many entries of the sealed document did not open on this device
   * (another key, or damage). They are passed over, so the editor may be
   * showing less than was written, and the caller says so.
   */
  unreadable: number;
}

const IDLE: NoteYDoc = {
  ydoc: null,
  awareness: null,
  status: "disabled",
  synced: false,
  outdated: false,
  unreadable: 0,
};

function wsUrl(): string | null {
  return WS_ORIGIN === null ? null : `${WS_ORIGIN}/api/v1/yjs`;
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
  // A note whose key was replaced while it is open starts again under the
  // new one: nothing more is written under a key someone removed holds.
  const keyVersion = noteId
    ? (sealer.value?.replaced.value.get(noteId) ?? 0)
    : 0;

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

    // The document is sealed with the note's key, so there is none to open
    // without it: locked, or a note whose key has not reached this account.
    const sealing = sealer.peek();
    const documentKey = sealing
      ? sealing.documentKey(noteId, sealedNote(noteId))
      : Promise.reject(new Error("locked"));

    Promise.all([import("./yjsSession.ts"), documentKey]).then(
      ([{ createYjsSession }, ring]) => {
        if (cancelled) return;
        session = createYjsSession({
          url,
          noteId,
          token,
          key: ring?.key ?? null,
          older: ring?.older,
          user: user
            ? { id: user.id, name: user.displayName, color: user.avatarColor }
            : null,
          // A session that was destroyed still speaks: its socket closes
          // once the last edits are sealed, and `synced` waits on entries
          // being opened. By then the state is the next session's, and
          // marking that one synced would bind an editor to an empty
          // document.
          onStatus: (status) => {
            if (!cancelled) setState((prev) => ({ ...prev, status }));
          },
          onSynced: () => {
            if (!cancelled) setState((prev) => ({ ...prev, synced: true }));
          },
          onUnreadable: (unreadable) => {
            if (!cancelled) setState((prev) => ({ ...prev, unreadable }));
          },
          onAuthenticationFailed: (reason) => {
            if (cancelled) return;
            setState((prev) => ({
              ...prev,
              status: "disconnected",
              synced: false,
              outdated: reason === EDITOR_OUTDATED_REASON,
            }));
          },
        });
        setState({
          ydoc: session.ydoc,
          awareness: session.awareness,
          status: "connecting",
          synced: false,
          outdated: false,
          unreadable: 0,
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
  }, [noteId, token, keyVersion]);

  return state;
}
