import fs from "node:fs";
import path from "node:path";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * GitHub Pages serves `404.html` for any unknown path, so we copy the built
 * `index.html` under that name to give the SPA a clean-URL fallback.
 */
function githubPagesSpaFallback(): Plugin {
  let outDir = "dist";
  return {
    name: "github-pages-spa-fallback",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const from = path.resolve(outDir, "index.html");
      const to = path.resolve(outDir, "404.html");
      if (fs.existsSync(from)) fs.copyFileSync(from, to);
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/manifesto/" : "/",
  plugins: [
    preact(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: false,
      injectManifest: {
        injectionPoint: undefined,
      },
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
      },
    }),
    githubPagesSpaFallback(),
  ],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
