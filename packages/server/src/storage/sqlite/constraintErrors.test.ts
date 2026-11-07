import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isUniqueViolation } from "./constraintErrors.ts";

/** The error that `run` throws, as better-sqlite3 gives it. */
function errorOf(run: () => void): unknown {
  try {
    run();
  } catch (err) {
    return err;
  }
  throw new Error("The statement did not fail");
}

describe("isUniqueViolation", () => {
  let db: Database.Database;
  const insert = (id: string | null, name: string | null) =>
    db.prepare("INSERT INTO t (id, name) VALUES (?, ?)").run(id, name);

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(
      "CREATE TABLE t (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, CHECK (name <> 'bad'))",
    );
    insert("a", "taken");
  });

  afterEach(() => {
    db.close();
  });

  it("accepts a taken unique value and a taken primary key", () => {
    expect(isUniqueViolation(errorOf(() => insert("b", "taken")))).toBe(true);
    expect(isUniqueViolation(errorOf(() => insert("a", "other")))).toBe(true);
  });

  it("refuses NOT NULL and CHECK failures", () => {
    expect(isUniqueViolation(errorOf(() => insert("b", null)))).toBe(false);
    expect(isUniqueViolation(errorOf(() => insert("b", "bad")))).toBe(false);
  });

  it("with a column, accepts only a constraint on that column", () => {
    const takenName = errorOf(() => insert("b", "taken"));
    expect(isUniqueViolation(takenName, "name")).toBe(true);
    expect(isUniqueViolation(takenName, "email")).toBe(false);
  });

  it("refuses a value that is not an error", () => {
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(false);
  });
});
