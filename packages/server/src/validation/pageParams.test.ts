import {
  DEFAULT_NOTES_PAGE_SIZE,
  MAX_NOTES_PAGE_SIZE,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { HttpError } from "../middleware/error.js";
import { encodeCursor } from "../storage/noteMapping.js";
import { readPageParams } from "./pageParams.js";

describe("readPageParams", () => {
  it("gives a page of the default size when no limit is asked for", () => {
    expect(readPageParams(undefined, undefined)).toEqual({
      limit: DEFAULT_NOTES_PAGE_SIZE,
    });
  });

  it("clamps a limit into range rather than refusing it", () => {
    expect(readPageParams("10", undefined).limit).toBe(10);
    expect(readPageParams("0", undefined).limit).toBe(1);
    expect(readPageParams("-5", undefined).limit).toBe(1);
    expect(readPageParams("7.9", undefined).limit).toBe(7);
    expect(readPageParams("100000", undefined).limit).toBe(MAX_NOTES_PAGE_SIZE);
    expect(readPageParams("Infinity", undefined).limit).toBe(
      DEFAULT_NOTES_PAGE_SIZE,
    );
    expect(readPageParams("ten", undefined).limit).toBe(
      DEFAULT_NOTES_PAGE_SIZE,
    );
  });

  it("passes on a cursor this server wrote", () => {
    const cursor = encodeCursor({
      updatedAt: "2026-01-01T00:00:00.000Z",
      id: "01J8Z3Q4R5S6T7V8W9X0Y1Z2AB",
    });
    expect(readPageParams("5", cursor)).toEqual({ limit: 5, cursor });
  });

  it("refuses a cursor it did not write, rather than start again from the top", () => {
    const forged = [
      "",
      "not a cursor",
      Buffer.from("2026-01-01T00:00:00.000Z", "utf8").toString("base64url"),
      Buffer.from("a\u0000b\u0000c", "utf8").toString("base64url"),
      Buffer.from("\u0000id", "utf8").toString("base64url"),
    ];
    for (const cursor of forged) {
      let thrown: unknown;
      try {
        readPageParams(undefined, cursor);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, JSON.stringify(cursor)).toBeInstanceOf(HttpError);
      expect((thrown as HttpError).status).toBe(400);
    }
  });
});
