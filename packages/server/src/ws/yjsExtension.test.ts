import type { onStoreDocumentPayload } from "@hocuspocus/server";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  MAX_YJS_BYTES,
  type YjsAuthContext,
  YjsPersistenceExtension,
} from "./yjsExtension.ts";

/** A store payload for a document holding `text`, with one connection. */
function payloadOf(text: string) {
  const document = new Y.Doc();
  document.getText("body").insert(0, text);
  const close = vi.fn();
  const payload = {
    document: Object.assign(document, {
      getConnections: () => [{ webSocket: { close } }],
    }),
    lastContext: { noteId: "note-1", ownerId: "owner-1" },
  } as unknown as onStoreDocumentPayload<YjsAuthContext>;
  return { payload, close };
}

describe("YjsPersistenceExtension", () => {
  it("stores a document's state under the note and its owner", async () => {
    const store = { load: vi.fn(), store: vi.fn() };
    const { payload, close } = payloadOf("hello");
    await new YjsPersistenceExtension(store).onStoreDocument(payload);
    expect(store.store).toHaveBeenCalledWith(
      "note-1",
      "owner-1",
      expect.any(Buffer),
      expect.any(Buffer),
    );
    expect(close).not.toHaveBeenCalled();
  });

  it("does not store a state over the limit, and puts its editors out", async () => {
    const store = { load: vi.fn(), store: vi.fn() };
    const { payload, close } = payloadOf("x".repeat(MAX_YJS_BYTES + 1));
    await new YjsPersistenceExtension(store).onStoreDocument(payload);
    expect(store.store).not.toHaveBeenCalled();
    // 1009: message too big.
    expect(close).toHaveBeenCalledWith(1009, "Document too large");
  });
});
