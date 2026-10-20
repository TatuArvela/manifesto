import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/**
 * Tells a note row written from outside the editor from a row that is only
 * behind it. Thus, the editor can take the first in, and continue to ignore the
 * second.
 *
 * When a note has a shared document, the editor shows the document, and never
 * the row. That is correct when the row is behind (an edit saved from a
 * different tab that did not reach this tab, or offline typing whose saves
 * failed). It is wrong when the row was written by a source that never changes
 * the document: the `update_note` of an assistant, a script on the REST API, a
 * restored version. The editor would show the old text, and its next save would
 * write that back over the change.
 *
 * The document keeps two records to decide which it is:
 * - **claims**: a hash of each text that an editor sent to the row, made
 *   *before* the send. A row that contains a claimed text came from the
 *   document, however late it arrives. The save of a different tab is always
 *   claimed when its broadcast arrives (approximately, within the delay that
 *   the caller permits).
 * - **savedAt**: the `updatedAt` of the server for the last save that arrived.
 *   A row that is not newer than it cannot contain anything that the document
 *   does not have.
 *
 * A row that is newer than `savedAt`, contains an unclaimed text, and is
 * different from the document was written from outside. A document with neither
 * record (each document from before this) never decides that a row is outside,
 * and starts to keep them the first time that the row and the document agree.
 *
 * Only `import type` from Yjs. This module is in the chunk of the editor, and
 * the Yjs runtime must stay out of the entry (see `realtime/yjsSession.ts`).
 */
export interface ContentAgreement {
  /**
   * Just before the editor sends `text` to the row, or after the document took
   * in the text of a row.
   */
  claim(text: string): void;
  /** After a save of the document arrived, with the `updatedAt` of the row. */
  confirm(updatedAt: string): void;
  /** If the row now contains a text that never came from the document. */
  isOutside(row: RowContent, documentText: string): boolean;
  wasClaimed(text: string): boolean;
  /**
   * If this client must write an outside change in. Each client that has the
   * document open sees the same row. If two of them wrote it in, the text would
   * be there two times.
   */
  leads(): boolean;
}

export interface RowContent {
  content: string;
  updatedAt: string;
}

/**
 * Sufficient claims to cover the saves that are still in progress, and the
 * saves that failed while offline since the last save that arrived, which
 * `savedAt` covers anyway.
 */
const MAX_CLAIMS = 50;

const CLAIMS_MAP = "manifesto:claims";
const AGREEMENT_MAP = "manifesto:agreement";

/** The serializer ends a document with a newline, and a textarea does not. */
function trimEnd(text: string): string {
  return text.replace(/\n+$/, "");
}

/** cyrb53: a claim only has to tell the texts of one note apart. */
export function contentHash(text: string): string {
  const s = trimEnd(text);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

interface Records {
  claims: {
    has(key: string): boolean;
    set(key: string, at: number): void;
    delete(key: string): void;
    entries(): IterableIterator<[string, number]>;
    readonly size: number;
  };
  savedAt(): string | null;
  setSavedAt(at: string): void;
  leads(): boolean;
}

function agreement(records: Records): ContentAgreement {
  const wasClaimed = (text: string) => records.claims.has(contentHash(text));
  return {
    claim(text) {
      const key = contentHash(text);
      if (records.claims.has(key)) return;
      records.claims.set(key, Date.now());
      if (records.claims.size <= MAX_CLAIMS) return;
      const oldest = [...records.claims.entries()]
        .sort(([, a], [, b]) => a - b)
        .slice(0, records.claims.size - MAX_CLAIMS);
      for (const [stale] of oldest) records.claims.delete(stale);
    },
    confirm(updatedAt) {
      const saved = records.savedAt();
      if (saved === null || Date.parse(updatedAt) > Date.parse(saved)) {
        records.setSavedAt(updatedAt);
      }
    },
    isOutside(row, documentText) {
      if (trimEnd(row.content) === trimEnd(documentText)) return false;
      const saved = records.savedAt();
      if (saved === null && records.claims.size === 0) return false;
      if (saved !== null && Date.parse(row.updatedAt) <= Date.parse(saved)) {
        return false;
      }
      return !wasClaimed(row.content);
    },
    wasClaimed,
    leads: records.leads,
  };
}

/** Kept in the shared document. Thus, all tabs and devices read the same. */
export function sharedAgreement(
  ydoc: Y.Doc,
  awareness: Awareness | null,
): ContentAgreement {
  const claims = ydoc.getMap<number>(CLAIMS_MAP);
  const meta = ydoc.getMap<string>(AGREEMENT_MAP);
  return agreement({
    claims,
    savedAt: () => meta.get("savedAt") ?? null,
    setSavedAt: (at) => meta.set("savedAt", at),
    // The lowest client id among the clients with the document open. Awareness
    // always contains the own state of this client. Thus, when alone, it leads.
    leads: () =>
      !awareness || Math.min(...awareness.getStates().keys()) === ydoc.clientID,
  });
}

/**
 * For an editor with no shared document: open mode, a viewer, or a server whose
 * collaboration stack was not available. Only this editor writes.
 *
 * Starts from the row from which the editor was built, which it has by
 * construction. When the first check recorded it, a row that changed before
 * that check (a restore in the first moments) found no records, and stayed out.
 */
export function localAgreement(opened: RowContent): ContentAgreement {
  let savedAt: string | null = opened.updatedAt;
  return agreement({
    claims: new Map([[contentHash(opened.content), Date.now()]]),
    savedAt: () => savedAt,
    setSavedAt: (at) => {
      savedAt = at;
    },
    leads: () => true,
  });
}
