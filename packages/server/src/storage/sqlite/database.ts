import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.ts";

export type SqliteDB = Database.Database;

export function openDatabase(path: string): SqliteDB {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // The built-in LOWER() of SQLite folds only ASCII. Thus, `LOWER('ÄITI')` is
  // `Äiti`, and a search for "äiti" misses the note. Postgres, whose LOWER()
  // knows the locale, finds it. An override with the function of JS gives both
  // drivers the same case folding. That is what a search means to a user who
  // types in a language with more letters than English.
  db.function("lower", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? value.toLowerCase() : (value as null),
  );
  runMigrations(db);
  return db;
}
