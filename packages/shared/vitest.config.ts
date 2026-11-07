import { defineConfig } from "vitest/config";

export default defineConfig({
  // `#/` imports read from the source. The import map sends all builds without
  // this condition to `dist/`. The others are the `defaultServerConditions` of
  // Vite, which this package cannot import, because it has no `vite`.
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
