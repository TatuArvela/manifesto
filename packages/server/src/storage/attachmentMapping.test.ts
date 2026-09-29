import { describe, expect, it } from "vitest";
import {
  referencedIds,
  referencedPreviewIds,
  referencesOf,
  refPattern,
  sweepAction,
} from "./attachmentMapping.js";

const A = "01J8Z3Q4R5S6T7V8W9X0Y1Z2AB";
const B = "01J8Z3Q4R5S6T7V8W9X0Y1Z2CD";
const C = "01J8Z3Q4R5S6T7V8W9X0Y1Z2EF";

/**
 * The sweep deletes an attachment nothing refers to. Everything here is about
 * the other direction: what does refer to one must be found, from either
 * column, or a picture a note still shows is deleted under it.
 */
describe("referencesOf", () => {
  it("finds every attachment a note's images and previews name", () => {
    expect(
      referencesOf({
        images: JSON.stringify([`attachment:${A}`]),
        link_previews: JSON.stringify([
          {
            url: "https://a.example",
            title: "A",
            domain: "a.example",
            image: `attachment:${B}`,
            favicon: `attachment:${C}`,
          },
        ]),
      }),
    ).toEqual([A, B, C]);
  });

  it("does not count an id a preview only spells out in its text", () => {
    expect(
      referencesOf({
        images: "[]",
        link_previews: JSON.stringify([
          {
            url: `https://a.example/attachment:${A}`,
            title: `attachment:${A}`,
            description: `attachment:${A}`,
            domain: "a.example",
          },
        ]),
      }),
    ).toEqual([]);
  });

  it("ignores what is not a reference: data URLs, local refs, remote URLs, malformed ids", () => {
    expect(
      referencedIds(
        JSON.stringify([
          "data:image/png;base64,AAAA",
          `local:${"a".repeat(64)}`,
          "https://img.example/x.png",
          "attachment:not-a-ulid",
          `attachment:${A.toLowerCase()}`,
          `attachment:${A}x`,
          42,
          null,
          `attachment:${A}`,
        ]),
      ),
    ).toEqual([A]);
  });

  it("reads a column that is empty, null, not JSON or not a list as naming nothing", () => {
    for (const raw of [null, "", "not json", "{}", '"attachment:x"', "null"]) {
      expect(referencedIds(raw), String(raw)).toEqual([]);
      expect(referencedPreviewIds(raw), String(raw)).toEqual([]);
    }
    expect(referencedPreviewIds(JSON.stringify([null, 1, "x"]))).toEqual([]);
  });
});

describe("refPattern", () => {
  it("finds the reference wherever it sits in a stored column", () => {
    const pattern = refPattern(A);
    expect(pattern).toBe(`%attachment:${A}%`);
    // What LIKE would do, spelled out: the id holds no wildcard of its own.
    expect(pattern.slice(1, -1)).not.toMatch(/[%_]/);
  });
});

describe("sweepAction", () => {
  const cutoff = "2026-09-01T00:00:00.000Z";

  it("never deletes an attachment something refers to", () => {
    expect(sweepAction(true, null, cutoff)).toBeNull();
    expect(sweepAction(true, "2020-01-01T00:00:00.000Z", cutoff)).toBe("clear");
  });

  it("marks one newly unreferenced, and waits out the grace period", () => {
    expect(sweepAction(false, null, cutoff)).toBe("mark");
    expect(sweepAction(false, "2026-09-02T00:00:00.000Z", cutoff)).toBeNull();
    expect(sweepAction(false, cutoff, cutoff)).toBeNull();
  });

  it("deletes one unreferenced since before the cutoff", () => {
    expect(sweepAction(false, "2026-08-31T23:59:59.999Z", cutoff)).toBe(
      "delete",
    );
  });
});
