import { NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { type Random, SEEDS, seeded } from "#/test/testRandom.ts";
import {
  BOARD_COLORS,
  BOARD_INKS,
  BOARD_TEXTURES,
  DARK_HUES,
  MAX_TAG_COLORS,
  PREF_KEYS,
  PREF_PARSERS,
  type PrefKey,
  parsePrefs,
} from "./prefParsers.ts";

/**
 * A preferences blob is what a different tab, an older version, the server or a
 * manual edit left in `localStorage`. Thus, each parser must take any value,
 * and give back a value that it would give back again without change. If not, a
 * value would change on each load and save, and the server copy with it.
 */

const SAMPLES: readonly unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -1,
  37.6,
  1e9,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "",
  "random",
  "custom",
  "violet",
  "cork",
  "#ABCDEF",
  "#abc",
  "red; background: url(x)",
  "__proto__",
  ...Object.values(NoteColor),
  ...Object.values(NoteFont),
  ...BOARD_COLORS,
  ...BOARD_INKS,
  ...BOARD_TEXTURES,
  ...DARK_HUES,
];

function sample(random: Random, depth = 0): unknown {
  const roll = random.int(10);
  if (depth < 2 && roll === 0) {
    return Array.from({ length: random.int(4) }, () =>
      sample(random, depth + 1),
    );
  }
  if (depth < 2 && roll === 1) {
    const entries = Array.from({ length: random.int(4) }, () => [
      String(random.pick(SAMPLES)),
      sample(random, depth + 1),
    ]);
    return Object.fromEntries(entries);
  }
  return random.pick(SAMPLES);
}

function parse(key: PrefKey, value: unknown): unknown {
  return PREF_PARSERS[key](value, {});
}

describe("PREF_PARSERS", () => {
  it.each(SEEDS)(
    "gives back a value it reads back unchanged (seed %i)",
    (seed) => {
      const random = seeded(seed);
      for (let round = 0; round < 5; round++) {
        for (const key of PREF_KEYS) {
          const raw = sample(random);
          const once = parse(key, raw);
          expect(
            parse(key, once),
            `${key} from ${JSON.stringify(raw)}`,
          ).toEqual(once);
        }
      }
    },
  );

  it.each(SEEDS)("gives back a value that survives JSON (seed %i)", (seed) => {
    const random = seeded(seed);
    for (let round = 0; round < 5; round++) {
      for (const key of PREF_KEYS) {
        const once = parse(key, sample(random));
        const stored: unknown = JSON.parse(JSON.stringify({ value: once }));
        expect(parse(key, (stored as { value: unknown }).value)).toEqual(once);
      }
    }
  });

  it.each(["__proto__", "toString", "constructor"])(
    "reads %s as no board colour, texture or gradient",
    (name) => {
      expect(PREF_PARSERS.boardColor(name)).toBe("none");
      expect(PREF_PARSERS.boardGradient(name)).toBe("none");
      expect(PREF_PARSERS.boardTexture(name)).toBe("none");
    },
  );

  it("writes only a six-digit hex colour into the board's CSS", () => {
    const parser = PREF_PARSERS.boardCustomColor;
    expect(parser("#ABCDEF")).toBe("#abcdef");
    expect(parser("#abc")).toBe(parse("boardCustomColor", undefined));
    expect(parser("red; background: url(x)")).toBe(
      parse("boardCustomColor", undefined),
    );
  });

  it("reads values the app once stored under another name", () => {
    expect(PREF_PARSERS.darkHue("violet")).toBe("lavender");
    expect(PREF_PARSERS.boardTexture("cork")).toBe("paper");
    expect(
      PREF_PARSERS.defaultNoteFont(undefined, {
        noteFont: NoteFont.PermanentMarker,
      }),
    ).toBe(NoteFont.PermanentMarker);
  });

  it("keeps no more tag colours than the account copy has room for", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_TAG_COLORS + 50 }, (_, i) => [
        `tag${i}`,
        NoteColor.Yellow,
      ]),
    );
    expect(Object.keys(PREF_PARSERS.tagColors(many))).toHaveLength(
      MAX_TAG_COLORS,
    );
  });

  it("clamps the pattern opacity to whole percent within its range", () => {
    const parser = PREF_PARSERS.boardTextureOpacity;
    expect(parser(1e9)).toBe(parser(parser(1e9)));
    expect(Number.isInteger(parser(37.6))).toBe(true);
  });
});

describe("parsePrefs", () => {
  it("gives every preference its default for a blob it cannot read", () => {
    const defaults = parsePrefs(null);
    expect(parsePrefs("{not json")).toEqual(defaults);
    expect(parsePrefs("[1,2]")).toEqual(defaults);
    expect(parsePrefs('"a string"')).toEqual(defaults);
    expect(Object.keys(defaults).sort()).toEqual([...PREF_KEYS].sort());
  });

  it("reads back what it was given as a blob", () => {
    const random = seeded(1);
    const blob = Object.fromEntries(
      PREF_KEYS.map((key) => [key, sample(random)]),
    );
    const loaded = parsePrefs(JSON.stringify(blob));
    expect(parsePrefs(JSON.stringify(loaded))).toEqual(loaded);
  });
});
