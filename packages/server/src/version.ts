import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The build writes the resolved version next to this module (see
 * `packages/build-version`). Thus, a server built after a release says how far
 * after. `tsx watch` runs from `src`, which has no such file, and uses the
 * release number in `package.json`.
 */
function readVersion(): string {
  try {
    return readFileSync(new URL("./VERSION", import.meta.url), "utf-8").trim();
  } catch {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version: string;
    };
    return pkg.version;
  }
}

export const VERSION: string = readVersion();
