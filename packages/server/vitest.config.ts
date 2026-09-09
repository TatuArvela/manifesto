import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package to its source, not its build output.
      //
      // `@manifesto/shared` exports `types: src/index.ts` but `import:
      // dist/index.js`, so a value added to shared and used here typechecks
      // against source while resolving at runtime to whatever tsc last emitted.
      // A stale dist therefore yields `undefined` at runtime with a green
      // typecheck — which is a very expensive thing to debug. Tests read the
      // same files the compiler checked.
      "@manifesto/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
