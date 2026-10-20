import type {
  Extension,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";
import { logger } from "#/lib/logger.ts";
import type { YjsStore } from "#/storage/types.ts";

/**
 * The maximum size of the collaborative state of a note, and thus the largest
 * frame that `/api/v1/yjs` reads. The text of a note stops at 100,000
 * characters, and its state is a small multiple of that, with the edit history.
 * Thus, this is much larger than any real note. Without it, each person who can
 * edit a note could make the row of its owner grow without limit. The state is
 * the only part of a note that no request schema sees.
 */
export const MAX_YJS_BYTES = 8 * 1024 * 1024;

/** The standard close code for a message that is too big. */
const CLOSE_TOO_BIG = 1009;

export interface YjsAuthContext {
  userId: string;
  noteId: string;
  /**
   * The owner of the note. The state is stored under the owner, whatever the
   * participant whose connection writes it.
   */
  ownerId: string;
  /**
   * The bearer token with which the connection authenticated. Thus, the end of
   * a session can find the sockets that it opened.
   */
  token: string;
  /** Who this connection is, as the `user` field of its awareness states. */
  user: AwarenessUser;
}

/** The label at a remote cursor, in the shape that `yCursorPlugin` reads. */
export interface AwarenessUser {
  id: string;
  name: string;
  color: string;
}

export class YjsPersistenceExtension implements Extension {
  extensionName = "manifesto-yjs-persistence";
  priority = 10;

  constructor(private store: YjsStore) {}

  async onLoadDocument(
    payload: onLoadDocumentPayload<YjsAuthContext>,
  ): Promise<Y.Doc | undefined> {
    const { context, document } = payload;
    if (!context?.ownerId || !context?.noteId) return undefined;
    const state = await this.store.load(context.noteId, context.ownerId);
    if (!state) return undefined;
    try {
      Y.applyUpdate(document, new Uint8Array(state));
    } catch (err) {
      logger.warn("Failed to apply persisted Y.Doc state", {
        noteId: context.noteId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return undefined;
  }

  async onStoreDocument(
    payload: onStoreDocumentPayload<YjsAuthContext>,
  ): Promise<void> {
    const { document } = payload;
    const ctx = payload.lastContext;
    if (!ctx?.ownerId || !ctx?.noteId) return;
    const state = Y.encodeStateAsUpdate(document);
    if (state.byteLength > MAX_YJS_BYTES) {
      // Not written. Thus, the stored state stays the last state that fitted,
      // and nobody stays connected to a document that only grows in memory.
      logger.warn("Y.Doc state is over the limit; not stored", {
        noteId: ctx.noteId,
        bytes: state.byteLength,
      });
      for (const connection of document.getConnections()) {
        connection.webSocket.close(CLOSE_TOO_BIG, "Document too large");
      }
      return;
    }
    const vector = Y.encodeStateVector(document);
    await this.store.store(
      ctx.noteId,
      ctx.ownerId,
      Buffer.from(state),
      Buffer.from(vector),
    );
  }
}
