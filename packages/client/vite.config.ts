import fs from "node:fs";
import path from "node:path";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolveBuildVersion } from "../build-version/src/index.ts";

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
      // ignore malformed URL and leave CSP unchanged
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

// Mirrored as `DEFAULT_APP_NAME` in `src/config.ts`, which decides from it
// whether a deployment is unbranded.
const DEFAULT_APP_NAME = "Manifesto";
const DEFAULT_APP_DESCRIPTION = "Sticky-note style note-taking app.";

/**
 * An image named by a branding variable, as the build publishes it: the file
 * on disk, and the name it is served at beside `index.html`. Null when the
 * variable is unset, or names nothing (with a warning, since a typo there
 * would otherwise just leave the stock mark in place with no word why).
 */
function brandImage(
  configured: string | undefined,
  publishedAs: string,
  variable: string,
) {
  const value = configured?.trim();
  if (!value) return null;
  const file = path.resolve(process.cwd(), value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    console.warn(
      `[branding] ${variable} points at ${file}, which is not a file; leaving it out.`,
    );
    return null;
  }
  return { file, name: `${publishedAs}${path.extname(file).toLowerCase()}` };
}

/**
 * The product and who runs it, and whether the welcome dialog greets users.
 * Resolved once, here, so the bundle (`__APP_NAME__`, `__BRANDING__`,
 * `__APP_WELCOME__`), `index.html`, and `manifest.webmanifest` cannot
 * disagree about any of it.
 *
 * Two kinds of name: the app's (its name and mark, "Manifesto" and the stock
 * logo unless replaced), and the deployment's own, all optional: the
 * instance ("Foo QA project") and the organisation behind it ("Acme Inc",
 * with its logo).
 */
function resolveBranding(env: Record<string, string>) {
  const pick = (configured: string | undefined, fallback: string) => {
    const trimmed = configured?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
  };
  const appLogo = brandImage(env.VITE_APP_LOGO, "app-logo", "VITE_APP_LOGO");
  const instanceLogo = brandImage(
    env.VITE_INSTANCE_LOGO,
    "instance-logo",
    "VITE_INSTANCE_LOGO",
  );
  const orgLogo = brandImage(env.VITE_ORG_LOGO, "org-logo", "VITE_ORG_LOGO");
  // Each logo's dark-theme variant, drawn in place of it while the app is
  // dark. The app's logo is inverted there only when it has none.
  const appLogoDark = brandImage(
    env.VITE_APP_LOGO_DARK,
    "app-logo-dark",
    "VITE_APP_LOGO_DARK",
  );
  const instanceLogoDark = brandImage(
    env.VITE_INSTANCE_LOGO_DARK,
    "instance-logo-dark",
    "VITE_INSTANCE_LOGO_DARK",
  );
  const orgLogoDark = brandImage(
    env.VITE_ORG_LOGO_DARK,
    "org-logo-dark",
    "VITE_ORG_LOGO_DARK",
  );
  return {
    appName: pick(env.VITE_APP_NAME, DEFAULT_APP_NAME),
    appDescription: pick(env.VITE_APP_DESCRIPTION, DEFAULT_APP_DESCRIPTION),
    // On unless switched off: a new user should hear where their notes go.
    appWelcome: /^(off|false|0|no)$/i.test(env.VITE_APP_WELCOME?.trim() ?? "")
      ? "off"
      : "on",
    instanceName: pick(env.VITE_INSTANCE_NAME, ""),
    // Whether the app's name follows the instance's in the window title.
    titleAppName: /^(off|false|0|no)$/i.test(
      env.VITE_TITLE_APP_NAME?.trim() ?? "",
    )
      ? "off"
      : "on",
    instanceLogo,
    // Whose name the top bar carries: the app's, or the instance's instead.
    headerBrand: /^instance$/i.test(env.VITE_HEADER_BRAND?.trim() ?? "")
      ? "instance"
      : "app",
    orgName: pick(env.VITE_ORG_NAME, ""),
    appLogo,
    orgLogo,
    appLogoDark,
    instanceLogoDark,
    orgLogoDark,
  };
}

type Branding = ReturnType<typeof resolveBranding>;

/** Enough for a value inside a double-quoted attribute or element text. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyBranding(
  src: string,
  branding: Branding,
  encode: (value: string) => string = (value) => value,
) {
  return src
    .replaceAll("%APP_NAME%", encode(branding.appName))
    .replaceAll("%APP_DESCRIPTION%", encode(branding.appDescription))
    .replaceAll("%APP_WELCOME%", branding.appWelcome)
    .replaceAll("%APP_LOGO%", branding.appLogo?.name ?? "logo.svg")
    .replaceAll("%INSTANCE_NAME%", encode(branding.instanceName))
    .replaceAll("%INSTANCE_LOGO%", branding.instanceLogo?.name ?? "")
    .replaceAll("%HEADER_BRAND%", branding.headerBrand)
    .replaceAll("%TITLE_APP_NAME%", branding.titleAppName)
    .replaceAll("%ORG_NAME%", encode(branding.orgName))
    .replaceAll("%ORG_LOGO%", branding.orgLogo?.name ?? "")
    .replaceAll("%APP_LOGO_DARK%", branding.appLogoDark?.name ?? "")
    .replaceAll("%INSTANCE_LOGO_DARK%", branding.instanceLogoDark?.name ?? "")
    .replaceAll("%ORG_LOGO_DARK%", branding.orgLogoDark?.name ?? "");
}

/**
 * Substitutes the `%APP_NAME%` / `%APP_DESCRIPTION%` placeholders in
 * `index.html`. Runs `pre` so the tokens are gone before Vite's own `%VITE_*%`
 * env replacement looks at the HTML.
 */
function brandingInHtml(branding: Branding): Plugin {
  return {
    name: "branding-in-html",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => applyBranding(html, branding, escapeHtml),
    },
  };
}

const IMAGE_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/**
 * Overlays `VITE_APP_ICONS_DIR` onto the served/built output, so a custom
 * instance keeps its brand marks (`favicon.svg`, `icon-1024.png`, `logo.svg`)
 * in its own folder outside the repository. Editing the checked-in `public/`
 * files would work too, but then every `git pull` from upstream is a conflict.
 *
 * A file only overrides if it is actually there: an icons dir holding just a
 * `logo.svg` leaves the stock favicon alone.
 */
function iconOverlay(dir: string | undefined): Plugin {
  let root = process.cwd();
  let outDir = "dist";
  const resolveDir = () => path.resolve(root, dir as string);
  return {
    name: "icon-overlay",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
      if (dir && !fs.existsSync(resolveDir())) {
        config.logger.warn(
          `[icon-overlay] VITE_APP_ICONS_DIR points at ${resolveDir()}, which does not exist; using the stock icons.`,
        );
      }
    },
    configureServer(server) {
      if (!dir) return;
      server.middlewares.use((req, res, next) => {
        const name = path.basename(req.url?.split("?")[0] ?? "");
        const file = path.join(resolveDir(), name);
        const type = IMAGE_TYPES[path.extname(name).toLowerCase()];
        // `path.join` on a basename cannot escape the directory, so a request
        // path can only ever name a file the operator put there themselves.
        if (!name || !type || !fs.existsSync(file)) return next();
        res.setHeader("Content-Type", type);
        res.end(fs.readFileSync(file));
      });
    },
    closeBundle() {
      if (!dir || !fs.existsSync(resolveDir())) return;
      for (const name of fs.readdirSync(resolveDir())) {
        const from = path.join(resolveDir(), name);
        if (!fs.statSync(from).isFile()) continue;
        fs.copyFileSync(from, path.resolve(outDir, name));
      }
    },
  };
}

/**
 * Publishes the logo variables (`VITE_APP_LOGO`, `VITE_INSTANCE_LOGO`,
 * `VITE_ORG_LOGO` and each one's `_DARK`) beside `index.html`, under the names
 * its meta tags carry (`app-logo.svg`, `org-logo-dark.png`, ...). Plain
 * files at fixed names, like the stock logo, so a release bundle's marks are
 * replaced the same way whichever path built it.
 */
function brandLogos(branding: Branding): Plugin {
  const images = [
    branding.appLogo,
    branding.instanceLogo,
    branding.orgLogo,
    branding.appLogoDark,
    branding.instanceLogoDark,
    branding.orgLogoDark,
  ].filter((image): image is NonNullable<typeof image> => image !== null);
  let outDir = "dist";
  return {
    name: "brand-logos",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = path.basename(req.url?.split("?")[0] ?? "");
        const image = images.find((candidate) => candidate.name === name);
        const type = IMAGE_TYPES[path.extname(name)];
        if (!image || !type) return next();
        res.setHeader("Content-Type", type);
        res.end(fs.readFileSync(image.file));
      });
    },
    closeBundle() {
      for (const image of images) {
        fs.copyFileSync(image.file, path.resolve(outDir, image.name));
      }
    },
  };
}

/**
 * Finishes `manifest.webmanifest`, which ships as a template in `public/`:
 *
 * - `%APP_NAME%` / `%APP_DESCRIPTION%` → the configured branding.
 * - `./` → the base URL, because iOS Safari does not reliably resolve relative
 *   paths in a manifest (start_url/scope/icons).
 *
 * The dev server has no build output to rewrite, so it gets the same treatment
 * through a middleware; otherwise an app installed from `pnpm dev` would be
 * called `%APP_NAME%`.
 */
function finalizeWebManifest(branding: Branding): Plugin {
  const FILE = "manifest.webmanifest";
  let outDir = "dist";
  let publicDir = "public";
  let base = "/";
  const render = (src: string) =>
    applyBranding(src, branding).replaceAll('"./', `"${base}`);
  return {
    name: "finalize-web-manifest",
    configResolved(config) {
      outDir = config.build.outDir;
      publicDir = config.publicDir;
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split("?")[0]?.endsWith(`/${FILE}`)) return next();
        const file = path.resolve(publicDir, FILE);
        if (!fs.existsSync(file)) return next();
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(render(fs.readFileSync(file, "utf-8")));
      });
    },
    closeBundle() {
      const file = path.resolve(outDir, FILE);
      if (!fs.existsSync(file)) return;
      fs.writeFileSync(file, render(fs.readFileSync(file, "utf-8")));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const branding = resolveBranding(env);
  return {
    // Plain env var rather than a `VITE_` one, since Vite reads `base` before
    // it loads the `VITE_` set. The default is the domain root, and a subpath
    // belongs to the build that wants one: keying it off `GITHUB_ACTIONS`
    // meant every fork's Actions build, not just this repo's Pages build,
    // silently produced a bundle whose assets all lived under `/manifesto/`.
    // Served at a root that is a blank page and a fistful of 404s, with
    // nothing in the output saying why. The Pages build sets it in
    // `.github/workflows/ci-main.yml`.
    base: process.env.MANIFESTO_BASE_URL ?? "/",
    define: {
      __APP_VERSION__: JSON.stringify(
        resolveBuildVersion({
          root: path.resolve(import.meta.dirname, "../.."),
        }),
      ),
      __APP_NAME__: JSON.stringify(branding.appName),
      __APP_WELCOME__: JSON.stringify(branding.appWelcome === "on"),
      __BRANDING__: JSON.stringify({
        appLogo: branding.appLogo?.name ?? "logo.svg",
        instanceName: branding.instanceName,
        instanceLogo: branding.instanceLogo?.name ?? "",
        headerBrand: branding.headerBrand,
        titleAppName: branding.titleAppName === "on",
        orgName: branding.orgName,
        orgLogo: branding.orgLogo?.name ?? "",
        appLogoDark: branding.appLogoDark?.name ?? "",
        instanceLogoDark: branding.instanceLogoDark?.name ?? "",
        orgLogoDark: branding.orgLogoDark?.name ?? "",
      }),
    },
    resolve: {
      alias: {
        // Read the workspace package from source rather than its build output.
        // `@manifesto/shared` exports `types: src/index.ts` but `import:
        // dist/index.js`, so a stale dist resolves to `undefined` at runtime
        // while the typecheck stays green. Same reasoning as the server's
        // vitest config.
        "@manifesto/shared": path.resolve(
          import.meta.dirname,
          "../shared/src/index.ts",
        ),
      },
    },
    plugins: [
      preact(),
      tailwindcss(),
      cspForServer(env.VITE_MANIFESTO_SERVER),
      brandingInHtml(branding),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "autoUpdate",
        injectRegister: false,
        manifest: false,
        injectManifest: {
          // Workbox's default, plus the Latin subset of each note font, so a
          // note opened offline keeps its face on a device that never showed
          // it online. `[0-9]` stops at the weight, which leaves out
          // `latin-ext`; that and the other scripts still load on demand.
          globPatterns: [
            "**/*.{js,wasm,css,html}",
            "assets/*-latin-[0-9]*.woff2",
          ],
        },
        devOptions: {
          enabled: true,
          type: "module",
          navigateFallback: "index.html",
        },
      }),
      githubPagesSpaFallback(),
      finalizeWebManifest(branding),
      iconOverlay(env.VITE_APP_ICONS_DIR),
      brandLogos(branding),
    ],
    test: {
      // Two projects, chosen by filename. Most of what we test is pure
      // (parsers, mergers, schedulers, formatters), and running those through
      // Playwright cost a browser launch per run for nothing. A test that
      // needs a DOM (real CSS, `localStorage`, history, an iframe, DOMPurify)
      // says so by being named `*.browser.test.ts`, so a new test lands in
      // the right project without anyone editing this file.
      projects: [
        {
          extends: true,
          test: {
            name: "node",
            environment: "node",
            include: ["src/**/*.test.{ts,tsx}"],
            exclude: ["src/**/*.browser.test.{ts,tsx}"],
          },
        },
        {
          extends: true,
          test: {
            name: "browser",
            include: ["src/**/*.browser.test.{ts,tsx}"],
            setupFiles: ["src/browserTestSetup.ts"],
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
    },
  };
});
