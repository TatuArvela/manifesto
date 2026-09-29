import {
  type LinkPreview,
  type Note,
  NoteColor,
  NoteFont,
  type NoteUpdate,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { type Random, SEEDS, seeded } from "../test/testRandom.js";
import { mergeNoteUpdate } from "./mergeNote.js";

/**
 * Two writers change the same note from the same starting point. The server
 * takes the first as sent; the second loses the `If-Match` race and is merged
 * onto the first's result (`mergeNoteUpdate`), as `updateNote` does on a 412.
 * Whichever gets there first, the note must end up the same.
 */

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Title",
    content: "Body",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

/** Small, so that two writers often add or remove the same item. */
const POOL = ["a", "b", "c", "d", "e", "f"];

/** A list as a writer would leave it: some of `base` removed, some added. */
function edit(random: Random, base: string[]): string[] {
  const kept = base.filter(() => random.chance(0.7));
  const added = random
    .subset(POOL, 0.3)
    .filter((item) => !base.includes(item) && !kept.includes(item));
  return [...kept, ...added];
}

/** The note after `first` is applied as sent and `second` merged onto it. */
function race(base: Note, first: NoteUpdate, second: NoteUpdate): Note {
  const afterFirst = { ...base, ...first };
  return { ...afterFirst, ...mergeNoteUpdate(base, second, afterFirst) };
}

const sorted = (items: string[]) => [...items].sort();

describe("mergeNoteUpdate, over generated pairs of writers", () => {
  it.each(["tags", "images"] as const)(
    "settles %s the same whichever writer lands first",
    (field) => {
      for (const seed of SEEDS) {
        const random = seeded(seed);
        const base = makeNote({ [field]: random.subset(POOL) });
        const a = { [field]: edit(random, base[field]) };
        const b = { [field]: edit(random, base[field]) };

        const ab = race(base, a, b)[field];
        const ba = race(base, b, a)[field];
        const context = { seed, base: base[field], a, b, ab, ba };

        // Both writers' additions, less both writers' removals.
        const removed = base[field].filter(
          (x) => !a[field].includes(x) || !b[field].includes(x),
        );
        const expected = [
          ...new Set([...base[field], ...a[field], ...b[field]]),
        ].filter((x) => !removed.includes(x));

        expect(sorted(ab), JSON.stringify(context)).toEqual(sorted(expected));
        expect(sorted(ba), JSON.stringify(context)).toEqual(sorted(expected));
        expect(new Set(ab).size, JSON.stringify(context)).toBe(ab.length);
      }
    },
  );

  it("settles link previews the same, and keeps an edit the other writer did not touch", () => {
    const preview = (url: string, title = url): LinkPreview => ({
      url,
      title,
      domain: url,
    });
    for (const seed of SEEDS) {
      const random = seeded(seed);
      const base = makeNote({
        linkPreviews: random.subset(POOL).map((url) => preview(url)),
      });
      const baseUrls = base.linkPreviews.map((p) => p.url);
      // Each writer adds and removes previews, and retitles some it keeps.
      const writer = (name: string) => ({
        linkPreviews: edit(random, baseUrls).map((url) =>
          baseUrls.includes(url) && random.chance(0.3)
            ? preview(url, `${url} by ${name}`)
            : preview(url),
        ),
      });
      const a = writer("a");
      const b = writer("b");

      const ab = race(base, a, b).linkPreviews;
      const ba = race(base, b, a).linkPreviews;
      const context = JSON.stringify({ seed, base: baseUrls, a, b, ab, ba });
      const urls = (list: LinkPreview[]) => sorted(list.map((p) => p.url));
      expect(urls(ab), context).toEqual(urls(ba));

      // A retitle survives when the other writer kept that preview as it was.
      for (const [mine, theirs] of [
        [a, b],
        [b, a],
      ] as const) {
        for (const edited of mine.linkPreviews) {
          if (edited.title === edited.url) continue;
          const other = theirs.linkPreviews.find((p) => p.url === edited.url);
          if (!other || other.title !== other.url) continue;
          for (const settled of [ab, ba]) {
            expect(
              settled.find((p) => p.url === edited.url)?.title,
              context,
            ).toBe(edited.title);
          }
        }
      }
    }
  });
});
