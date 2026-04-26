import type {
  Extension,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/time.js";
import type { YjsStore } from "../storage/types.js";

export interface YjsAuthContext {
  userId: string;
  noteId: string;
}

export class YjsPersistenceExtension implements Extension {
  extensionName = "manifesto-yjs-persistence";
  priority = 10;

  constructor(private store: YjsStore) {}

  async onLoadDocument(
    payload: onLoadDocumentPayload<YjsAuthContext>,
  ): Promise<Y.Doc | undefined> {
    const { context, document } = payload;
    if (!context?.userId || !context?.noteId) return undefined;
    const state = await this.store.load(context.noteId, context.userId);
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
    if (!ctx?.userId || !ctx?.noteId) return;
    const state = Y.encodeStateAsUpdate(document);
    const vector = Y.encodeStateVector(document);
    await this.store.store(
      ctx.noteId,
      ctx.userId,
      Buffer.from(state),
      Buffer.from(vector),
      nowIso(),
    );
  }
}
