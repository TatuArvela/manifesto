import type {
  Extension,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";
import type { DB } from "../db/index.js";
import { logger } from "../lib/logger.js";

export interface YjsAuthContext {
  userId: string;
  noteId: string;
}

interface YjsStateRow {
  yjs_state: Buffer | null;
}

export class SqliteYjsStore implements Extension {
  extensionName = "manifesto-sqlite-yjs-store";
  priority = 10;

  private fetchStmt;
  private storeStmt;

  constructor(private db: DB) {
    this.fetchStmt = db.prepare(
      `SELECT yjs_state FROM notes
       WHERE id = ? AND user_id = ?`,
    );
    this.storeStmt = db.prepare(
      `UPDATE notes
         SET yjs_state = @state,
             yjs_state_vector = @stateVector,
             updated_at = @updatedAt
       WHERE id = @id AND user_id = @userId`,
    );
  }

  async onLoadDocument(
    payload: onLoadDocumentPayload<YjsAuthContext>,
  ): Promise<Y.Doc | undefined> {
    const { context, document } = payload;
    if (!context?.userId || !context?.noteId) return undefined;
    const row = this.fetchStmt.get(context.noteId, context.userId) as
      | YjsStateRow
      | undefined;
    if (!row?.yjs_state) return undefined;
    try {
      Y.applyUpdate(document, new Uint8Array(row.yjs_state));
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
    this.storeStmt.run({
      state: Buffer.from(state),
      stateVector: Buffer.from(vector),
      updatedAt: new Date().toISOString(),
      id: ctx.noteId,
      userId: ctx.userId,
    });
  }
}
