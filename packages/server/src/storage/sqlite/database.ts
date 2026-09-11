import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type SqliteDB = Database.Database;

export function openDatabase(path: string): SqliteDB {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // SQLite's built-in LOWER() folds ASCII only, so `LOWER('ÄITI')` is `Äiti`
  // and a search for "äiti" misses the note — where Postgres, whose LOWER()
  // is locale-aware, finds it. Overriding it with the JS one puts both
  // drivers on the same case-folding, which is what a search means to a user
  // typing in a language with more letters than English.
  db.function("lower", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? value.toLowerCase() : (value as null),
  );
  runMigrations(db);
  return db;
}
