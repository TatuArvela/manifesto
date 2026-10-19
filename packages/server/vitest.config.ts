import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package to its source, not to its build output.
      //
      // `@manifesto/shared` exports `types: src/index.ts` but `import:
      // dist/index.js`. Thus, a value added to shared and used here typechecks
      // against the source, but resolves at runtime to the last output of tsc.
      // Thus, a stale dist gives `undefined` at runtime with a successful
      // typecheck. That is very expensive to debug. Tests read the same files
      // that the compiler checked.
      "@manifesto/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
    },
  },
  // `#/` imports, in this package and in shared, read from the source. The
  // import maps send all builds without this condition to `dist/`. The others
  // are the `defaultServerConditions` of Vite, which this package cannot
  // import, because it has no `vite`.
  ssr: {
    resolve: {
      conditions: [
        "module",
        "node",
        "development|production",
        "manifesto-source",
      ],
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
