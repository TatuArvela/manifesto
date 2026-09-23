import type { NoteUpdate } from "@manifesto/shared";
import { searchPattern } from "./noteMapping.js";

/**
 * The search index both drivers keep: each note's words, one row per
 * distinct word in `note_terms`, and a search that finds notes holding a word
 * starting with each word of the query.
 *
 * The words are cut here, in JavaScript, not by the database. SQLite's FTS5
 * and Postgres's `tsvector` tokenize differently (what counts as a word, what
 * is stemmed, how case folds), so a native index in each would have the two
 * drivers disagree about what a search finds, and the Postgres one could not
 * be tested at all on pg-mem, which has neither. With the words decided in one
 * place, the drivers only store and look up strings, and their answers match
 * by construction.
 *
 * A lookup is a range scan on a B-tree (`term >= lo AND term < hi`), which
 * both databases answer from an index. That needs the byte order of the
 * UTF-8 text, which is SQLite's default and Postgres's `COLLATE "C"`: under a
 * linguistic collation the range would not hold only the words that begin
 * with the prefix.
 */

/**
 * The tokenizer's version. Bumping it re-indexes every note at the next
 * startup (see `notes.search_version`), so a change to how words are cut
 * reaches notes written before it.
 */
export const SEARCH_INDEX_VERSION = 1;

/** Longer words are cut to this; nobody types a longer prefix. */
const MAX_TERM_LENGTH = 64;
/** A bound on one note's rows; far past any note a person wrote. */
const MAX_TERMS_PER_NOTE = 10_000;
/** A bound on one query's subqueries. */
const MAX_QUERY_TERMS = 16;

// Word boundaries per Unicode (UAX #29), which also splits scripts written
// without spaces. "und" keeps the answer independent of the server's locale.
const segmenter = new Intl.Segmenter("und", { granularity: "word" });

/**
 * Case folds as `LOWER()` does in both drivers (see `sqlite/database.ts`), so
 * a word search and the substring fallback agree about case.
 */
function* words(text: string): Generator<string> {
  for (const segment of segmenter.segment(text.normalize("NFC"))) {
    if (!segment.isWordLike) continue;
    yield [...segment.segment.toLowerCase()].slice(0, MAX_TERM_LENGTH).join("");
  }
}

// A checklist item's box. The `x` of a ticked one is markup, not a word, and
// indexing it would have a search for "x" find every finished list.
const TASK_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/gm;

/** A note's distinct words and how often each occurs. */
export function noteTerms(title: string, content: string): Map<string, number> {
  const terms = new Map<string, number>();
  const text = `${title}\n${content.replace(TASK_MARKER, "$1")}`;
  for (const word of words(text)) {
    const count = terms.get(word);
    if (count !== undefined) {
      terms.set(word, count + 1);
    } else if (terms.size < MAX_TERMS_PER_NOTE) {
      terms.set(word, 1);
    }
  }
  return terms;
}

/**
 * The words of a query, each to be matched as a prefix. Empty when the query
 * has no word in it (punctuation, an emoji), which is the caller's cue to
 * fall back to a substring match.
 */
export function queryTerms(query: string): string[] {
  const terms = [...new Set(words(query))];
  // A shorter prefix is implied by a longer one that extends it.
  return terms
    .filter(
      (term) =>
        !terms.some((other) => other !== term && other.startsWith(term)),
    )
    .slice(0, MAX_QUERY_TERMS);
}

/**
 * The half-open range `[lo, hi)` of strings that start with `prefix`, in code
 * point order (which is UTF-8 byte order): `hi` is the prefix with its last
 * code point incremented.
 */
export function prefixRange(prefix: string): [string, string] {
  const points = [...prefix].map((c) => c.codePointAt(0) as number);
  let next = (points.pop() as number) + 1;
  // Surrogate code points are not characters; step over them.
  if (next >= 0xd800 && next <= 0xdfff) next = 0xe000;
  if (next > 0x10ffff) return [prefix, `${prefix}\u{10ffff}`];
  return [prefix, String.fromCodePoint(...points, next)];
}

/** What a search narrows a listing to: its words, or failing any, a
 * substring (`searchPattern`). */
export type SearchFilter =
  | { kind: "terms"; ranges: [string, string][] }
  | { kind: "like"; like: string };

/** Null when there is nothing to search for. */
export function searchFilter(query: string): SearchFilter | null {
  const terms = queryTerms(query);
  if (terms.length > 0) {
    return { kind: "terms", ranges: terms.map(prefixRange) };
  }
  const like = searchPattern(query);
  return like === null ? null : { kind: "like", like };
}

/** Whether a write changes the words, and so the note's index. */
export function touchesText(changes: NoteUpdate): boolean {
  return changes.title !== undefined || changes.content !== undefined;
}
