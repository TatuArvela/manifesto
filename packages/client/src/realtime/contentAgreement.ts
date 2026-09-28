import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/**
 * Tells a note row written from outside the editor apart from one that is
 * merely behind it, so the editor can take the first in and keep ignoring the
 * second.
 *
 * Once a note has a shared document, the editor shows the document and never
 * the row. That is right when the row is behind (an edit saved from another
 * tab that has not reached this one, or offline typing whose saves failed),
 * and wrong when the row was written by something that never touches the
 * document: an assistant's `update_note`, a script on the REST API, a
 * restored version. The editor then showed the old text, and its next save
 * wrote that back over the change.
 *
 * The document keeps two records to decide which it is:
 * - **claims**: a hash of each text an editor sent to the row, made *before*
 *   sending. A row holding a claimed text came from the document, however
 *   late it arrives, and another tab's save is always claimed by the time its
 *   broadcast lands (give or take the delay the caller allows for).
 * - **savedAt**: the server's `updatedAt` for the last save that landed. A
 *   row no newer than it cannot hold anything the document lacks.
 *
 * A row that is newer than `savedAt`, holds an unclaimed text and differs from
 * the document was written from outside. A document with neither record
 * (every document from before this) never judges a row outside, and starts
 * keeping them the first time row and document agree.
 *
 * Only `import type` from Yjs: this module sits in the editor's chunk, and the
 * Yjs runtime must stay out of the entry (see `realtime/yjsSession.ts`).
 */
export interface ContentAgreement {
  /** Just before the editor sends `text` to the row, or once the document
   * has taken in a row's text. */
  claim(text: string): void;
  /** Once a save of the document has landed, with the row's `updatedAt`. */
  confirm(updatedAt: string): void;
  /** Whether the row now holds a text that never came from the document. */
  isOutside(row: RowContent, documentText: string): boolean;
  wasClaimed(text: string): boolean;
  /** Whether this client is the one to write an outside change in. Every
   * client that has the document open sees the same row, and two of them
   * writing it in would put the text in twice. */
  leads(): boolean;
}

export interface RowContent {
  content: string;
  updatedAt: string;
}

/** Enough claims to cover the saves still in flight, and those that failed
 * since the last one landed while offline, which `savedAt` covers anyway. */
const MAX_CLAIMS = 50;

const CLAIMS_MAP = "manifesto:claims";
const AGREEMENT_MAP = "manifesto:agreement";

/** The serializer ends a document with a newline and a textarea does not. */
function trimEnd(text: string): string {
  return text.replace(/\n+$/, "");
}

/** cyrb53: a claim only has to tell texts of one note apart. */
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

/** Kept in the shared document, so every tab and device reads the same. */
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
    // The lowest client id among those with the document open. Awareness
    // always holds this client's own state, so alone it leads.
    leads: () =>
      !awareness || Math.min(...awareness.getStates().keys()) === ydoc.clientID,
  });
}

/** For an editor with no shared document: open mode, a viewer, or a server
 * whose collaboration stack could not be reached. Only this editor writes.
 *
 * Starts from the row the editor was built from, which it holds by
 * construction. Left to be recorded by the first check instead, a row that
 * changed before that check (a restore in the first moments) found no
 * records and was kept out. */
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
