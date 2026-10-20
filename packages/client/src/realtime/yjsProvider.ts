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
   * True after the state of the server merged into the local doc. Callers must
   * not bind an editor before this. `ySyncPlugin` adopts what the shared
   * fragment contains. Thus, an early binding shows an empty document, and then
   * writes that empty state back as the content of the note.
   */
  synced: boolean;
  /**
   * The server refused the editor of this build as older than its own. Any
   * other edit of the text would write the reading of the note of this build
   * over content that it possibly does not understand. Thus, the caller locks
   * the text, and asks for a reload.
   */
  outdated: boolean;
  /**
   * How many entries of the sealed document did not open on this device (a
   * different key, or damage). The code skips them. Thus, the editor can show
   * less than was written, and the caller tells this.
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
 * Returns a Y.Doc bound to the given note id, with WebSocket sync to the server
 * and IndexedDB persistence for offline buffering. Returns { ydoc: null } when
 * not in server mode or not authenticated. The caller must then use plain
 * (non-collaborative) editing.
 *
 * The collaboration stack itself loads on demand (see `yjsSession`). Thus, the
 * document shows one microtask and one network fetch after the hook first asks
 * for it. `status` is `loading` for that time. A chunk that does not arrive
 * reports `disconnected` with no document. That puts the caller in the same
 * non-collaborative fallback as open mode, and does not leave an editor that
 * waits for a document that will never come.
 */
export function useNoteYDoc(noteId: string | null): NoteYDoc {
  const [state, setState] = useState<NoteYDoc>(IDLE);
  // Read the token through the value, so that the dependency array has a
  // meaning. A token rotation (a login change, a logout that the server forces)
  // closes the provider, and connects again with the new credentials.
  const token = authToken.value;
  // A note whose key was replaced while it is open starts again under the new
  // key. Nothing more is written under a key that a removed person has.
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

    // Loaded together with the session, not when the editor asks for it. The
    // editor asks at the moment when we report `synced`, and a fetch then would
    // leave the body of the note blank for a round trip. The code does not wait
    // for it. The editor awaits the same memoized promise.
    void loadYjsCollab().catch(() => {});

    // The document is sealed with the key of the note. Thus, without it there
    // is nothing to open: locked, or a note whose key did not reach this
    // account.
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
          // A session that was destroyed still sends data. Its socket closes
          // after the last edits are sealed, and `synced` waits for entries to
          // open. By then, the state belongs to the next session, and a mark of
          // that session as synced would bind an editor to an empty document.
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
