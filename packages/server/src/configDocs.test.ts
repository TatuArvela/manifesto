import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `docs/specification/server/deployment.md` is the source of truth for the env
 * vars of the server. Thus, if the server reads a variable that the document
 * does not name, no host can find it. The `noProcessEnv` rule of Biome keeps
 * each read in `config.ts` and `lib/logger.ts`. Each read is
 * `process.env.NAME`, or a helper that gets the name as a literal. Thus, it is
 * sufficient to read those two files. `features.test.ts` checks the feature
 * toggles in the same way.
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
    // A scan that finds nothing would pass all documents. The server reads
    // dozens.
    expect(read.length).toBeGreaterThan(30);
    expect(read.filter((name) => !doc.includes(`\`${name}\``))).toEqual([]);
  });
});
