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

/**
 * iOS Safari does not reliably resolve relative paths in `manifest.webmanifest`
 * (start_url/scope/icons), so we rewrite `./` → base URL at build time.
 */
function rewriteManifestBase(): Plugin {
  let outDir = "dist";
  let base = "/";
  return {
    name: "rewrite-manifest-base",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
      base = config.base;
    },
    closeBundle() {
      const file = path.resolve(outDir, "manifest.webmanifest");
      if (!fs.existsSync(file)) return;
      const src = fs.readFileSync(file, "utf-8");
      fs.writeFileSync(file, src.replaceAll('"./', `"${base}`));
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
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
      },
    }),
    githubPagesSpaFallback(),
    rewriteManifestBase(),
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
