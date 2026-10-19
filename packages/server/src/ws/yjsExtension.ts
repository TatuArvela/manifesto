import type {
  Extension,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";
import { logger } from "#/lib/logger.ts";
import type { YjsStore } from "#/storage/types.ts";

/**
 * The most a note's collaborative state may weigh, and so the largest frame
 * `/api/v1/yjs` reads. A note's text stops at 100,000 characters and its state
 * is a small multiple of that, edit history included, so this is far above
 * any real note. Without it anyone who may edit a note could grow the row
 * its owner keeps it in without end: the state is the one part of a note no
 * request schema sees.
 */
export const MAX_YJS_BYTES = 8 * 1024 * 1024;

/** Standard close code for a message too big to take. */
const CLOSE_TOO_BIG = 1009;

export interface YjsAuthContext {
  userId: string;
  noteId: string;
  /** Whose note it is. The state is stored under the owner whichever
   * participant's connection happens to write it. */
  ownerId: string;
  /** The bearer token the connection authenticated with, so ending a session
   * can find the sockets it opened. */
  token: string;
  /** Who this connection is, as the `user` field of its awareness states. */
  user: AwarenessUser;
}

/** The label at a remote cursor, in the shape `yCursorPlugin` reads. */
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
      // Not written, so what is stored stays the last state that fitted, and
      // nobody stays connected to a document that only grows in memory.
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
