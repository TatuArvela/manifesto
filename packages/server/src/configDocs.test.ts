import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `docs/specification/server/deployment.md` is the source of truth for the
 * server's env vars, so a variable the server reads and the doc does not name
 * is one no host can find. Biome's `noProcessEnv` keeps every read in
 * `config.ts` and `lib/logger.ts`, each either `process.env.NAME` or a helper
 * given the name as a literal, which is what makes reading those two files
 * enough. The feature toggles are checked the same way in `features.test.ts`.
 */
const READERS = ["./config.ts", "./lib/logger.ts"];
const DOC = "../../../docs/specification/server/deployment.md";

const READ =
  /process\.env\.([A-Z][A-Z0-9_]*)|\benv(?:Bool|Int|List|Enum|Required)(?:<[^>]*>)?\(\s*"([A-Z][A-Z0-9_]*)"/g;

function variablesRead(): string[] {
  const names = new Set<string>();
  for (const file of READERS) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const match of source.matchAll(READ)) {
      names.add(match[1] ?? match[2] ?? "");
    }
  }
  names.delete("");
  return [...names].sort();
}

describe("the deployment doc", () => {
  it("names every env var the server reads", () => {
    const doc = readFileSync(new URL(DOC, import.meta.url), "utf8");
    const read = variablesRead();
    // A scan that finds nothing would pass anything: the server reads dozens.
    expect(read.length).toBeGreaterThan(30);
    expect(read.filter((name) => !doc.includes(`\`${name}\``))).toEqual([]);
  });
});
