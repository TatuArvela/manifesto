import fs from "node:fs";
import path from "node:path";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, loadEnv, type Plugin } from "vite";
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
 * Extends the index.html CSP `connect-src` directive with the configured
 * `VITE_MANIFESTO_SERVER` origin (and its ws(s):// equivalent) so the client
 * can reach the Manifesto server's REST + WebSocket endpoints. When the env
 * var is unset, the CSP stays at `connect-src 'self'` and the client runs in
 * pure local mode.
 */
function cspForServer(serverUrl: string | undefined): Plugin {
  const extras: string[] = [];
  if (serverUrl && serverUrl.length > 0) {
    try {
      const url = new URL(serverUrl);
      const httpOrigin = `${url.protocol}//${url.host}`;
      const wsScheme = url.protocol === "https:" ? "wss:" : "ws:";
      const wsOrigin = `${wsScheme}//${url.host}`;
      extras.push(httpOrigin, wsOrigin);
    } catch {
      // ignore malformed URL — leave CSP unchanged
    }
  }
  return {
    name: "csp-for-server",
    transformIndexHtml(html) {
      if (extras.length === 0) return html;
      return html.replace(
        /connect-src\s+([^;]+)/,
        (_, sources) => `connect-src ${sources.trim()} ${extras.join(" ")}`,
      );
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
  base: process.env.GITHUB_ACTIONS ? "/manifesto/" : "/",
  plugins: [
    preact(),
    tailwindcss(),
    cspForServer(env.VITE_MANIFESTO_SERVER),
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
  };
});
