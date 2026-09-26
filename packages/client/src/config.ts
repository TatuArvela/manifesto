/**
 * Branding: the product name shown to users.
 *
 * Two ways to set it, so both kinds of self-hoster are served:
 *
 * - **Building from source**: set `VITE_APP_NAME`. It is resolved once in
 *   `vite.config.ts` and reaches the bundle as `__APP_NAME__`, `index.html` as
 *   the `<title>` and the `application-name` meta tag, and
 *   `manifest.webmanifest` as `name`/`short_name`.
 * - **Deploying the release zip**: edit the `application-name` meta tag in the
 *   shipped `index.html` (plus the `<title>` and the manifest, which are plain
 *   text in the same folder). Nobody should need a toolchain to rename an app,
 *   and the JS bundle is minified past the point of safe hand-editing.
 *
 * The meta tag wins when present, so an edited bundle overrides what it was
 * built with. Everything downstream (the header, the login screen, download
 * filenames, and any translated string containing `{appName}`) follows from
 * {@link APP_NAME}.
 */

/** The unsubstituted build-time token, in case the raw template gets served. */
const PLACEHOLDER = "%APP_NAME%";

/**
 * The `application-name` meta tag if the document carries a usable one, else
 * `fallback` (the name baked in at build time). Exported for the tests, which
 * cannot re-import this module with a different document.
 */
export function resolveAppName(fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const content = document
    .querySelector<HTMLMetaElement>('meta[name="application-name"]')
    ?.content?.trim();
  if (!content || content === PLACEHOLDER) return fallback;
  return content;
}

export const APP_NAME: string = resolveAppName(__APP_NAME__);

/**
 * Whether a first-time visitor is greeted by the welcome dialog, which says
 * what the app is and, above all, where their notes are kept.
 *
 * On by default. Switched off with `VITE_APP_WELCOME=off` at build time, or in
 * a release bundle by setting the `welcome-dialog` meta tag in `index.html` to
 * `off`, for the same reason the name is read from a meta tag: an operator
 * should not need a toolchain for it. The tag wins when it holds a value it
 * recognises.
 */
export function resolveWelcomeEnabled(fallback: boolean): boolean {
  if (typeof document === "undefined") return fallback;
  const content = document
    .querySelector<HTMLMetaElement>('meta[name="welcome-dialog"]')
    ?.content?.trim()
    .toLowerCase();
  if (content === "on" || content === "true") return true;
  if (content === "off" || content === "false") return false;
  return fallback;
}

export const WELCOME_ENABLED: boolean = resolveWelcomeEnabled(__APP_WELCOME__);

/** The unsubstituted build-time token, in case the raw template gets served. */
const SERVER_PLACEHOLDER = "%MANIFESTO_SERVER%";

function usableServer(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === SERVER_PLACEHOLDER) return null;
  return trimmed;
}

/**
 * The Manifesto server this deployment talks to, or null for open mode.
 *
 * Two ways to set it, the same pair as the product name:
 *
 * - **Building from source**: set `VITE_MANIFESTO_SERVER`. `vite.config.ts`
 *   also widens the `connect-src` in `index.html` to the server's HTTP and
 *   `ws(s)://` origins, so the address and the policy cannot disagree.
 * - **Deploying the release zip**: fill in the `manifesto-server` meta tag in
 *   the shipped `index.html`. That one is not enough on its own, because the
 *   CSP in the same file still says `connect-src 'self'` and the browser
 *   blocks every request until the server's origins are added there too.
 *   `main.tsx` checks for exactly that mismatch at startup and says so, since
 *   the alternative is a login screen that fails with no explanation. See
 *   `utils/serverCsp.ts`.
 *
 * The tag wins when it holds a value, so an edited bundle overrides what it
 * was built with. Empty, absent or an unsubstituted placeholder means open
 * mode, which is what the published zip ships as and what it keeps doing if
 * nobody touches the tag.
 *
 * A trailing slash is stripped, so `https://notes.example.com/` and the same
 * without agree. `/` therefore resolves to the empty string rather than null,
 * which is the deliberate same-origin case: requests go to this page's own
 * origin, and `'self'` already permits them.
 */
export function resolveServerUrl(fallback: string | undefined): string | null {
  const fromTag =
    typeof document === "undefined"
      ? undefined
      : document.querySelector<HTMLMetaElement>('meta[name="manifesto-server"]')
          ?.content;
  const raw = usableServer(fromTag) ?? usableServer(fallback);
  return raw === null ? null : raw.replace(/\/+$/, "");
}

/**
 * The server as an absolute URL, resolved the way the browser would.
 *
 * {@link resolveServerUrl} keeps whatever was configured, which may be
 * relative (`/`, or `/notes` behind a path-stripping proxy). That is the right
 * base for `fetch`, which resolves it against the page. It is not enough for
 * everything: `new WebSocket("/api/ws")` is not a thing, and the welcome
 * dialog has a host to name. Those callers take this instead.
 *
 * Null in open mode, and null when there is no document to resolve a relative
 * value against, which is any non-browser caller.
 */
export function resolveServerOrigin(serverUrl: string | null): string | null {
  if (serverUrl === null) return null;
  if (/^https?:\/\//i.test(serverUrl)) return serverUrl;
  if (typeof window === "undefined") return null;
  return `${window.location.origin}${serverUrl}`;
}

/**
 * Reduce a product name to something safe to put in a filename. Diacritics are
 * folded rather than dropped, so "Müistiö" becomes `muistio`; a name with no
 * ASCII letters or digits left after folding (a CJK-only name, say) falls back
 * to `notes` so downloads never end up called `-export-2026-01-01.json`.
 */
export function toFileSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "notes"
  );
}

/** Prefix for exports and crash backups (`manifesto-export-2026-01-01.json`). */
export const APP_FILE_SLUG: string = toFileSlug(APP_NAME);

/**
 * A branding meta tag's value, or null when the document has none, it is
 * empty, or it still holds a `%PLACEHOLDER%` because the raw template is being
 * served.
 */
function metaValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const content = document
    .querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
    ?.content?.trim();
  if (!content || /^%[A-Z_]+%$/.test(content)) return null;
  return content;
}

/**
 * One of the deployment's own names: the meta tag if it holds one, else what
 * the build was given, else null for a deployment that did not set it. The
 * same pair of paths as {@link resolveAppName}, for the same reason.
 */
export function resolveBrandText(tag: string, fallback: string): string | null {
  return metaValue(tag) ?? (fallback.trim() || null);
}

/**
 * A branding image as a URL the page can load. A bare file name is one beside
 * `index.html`, so it is base-prefixed for a subpath deployment; an absolute
 * path or a `data:` URL is taken as it is. A remote `https:` URL would be too,
 * and is then refused by the page's `img-src 'self'`, which is why the docs
 * say to ship the file with the build.
 */
export function resolveLogoUrl(
  value: string | null,
  base: string = import.meta.env.BASE_URL,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^(\/|[a-z][a-z0-9+.-]*:)/i.test(trimmed)) return trimmed;
  return `${base}${trimmed}`;
}

/**
 * A logo in both themes. `dark` is drawn in place of `light` while the app is
 * dark, if the deployment gave one; without it, `invertInDark` says whether
 * `light` is inverted there instead (the app's mark is, as a single-colour
 * shape; an instance's or organisation's logo keeps its colours).
 */
export interface Logo {
  light: string;
  dark: string | null;
  invertInDark: boolean;
}

/**
 * A logo from its meta tags (`<tag>` and `<tag>-dark`) or the build's values,
 * or null when there is no light one to draw: a dark variant alone has
 * nothing to stand in for.
 */
export function resolveLogo(
  tag: string,
  fallback: { light: string; dark: string },
  invertInDark: boolean,
): Logo | null {
  const light = resolveLogoUrl(metaValue(tag) ?? (fallback.light || null));
  if (!light) return null;
  return {
    light,
    dark: resolveLogoUrl(metaValue(`${tag}-dark`) ?? (fallback.dark || null)),
    invertInDark,
  };
}

/**
 * The app's mark: the header, the sign-in screen, the welcome dialog, About. A
 * plain file at a fixed name beside `index.html` rather than a hashed import,
 * so replacing it is the same kind of job as replacing the favicon.
 * `logo.svg` unless `VITE_APP_LOGO` or the `app-logo` meta tag names another.
 */
export const APP_LOGO: Logo = resolveLogo(
  "app-logo",
  { light: __BRANDING__.appLogo, dark: __BRANDING__.appLogoDark },
  true,
) ?? {
  light: `${import.meta.env.BASE_URL}logo.svg`,
  dark: null,
  invertInDark: true,
};

/**
 * What this copy is for, when a deployment names it ("Foo QA project"): shown
 * beside the app's name in the header and the tab, and on the sign-in screen,
 * so two instances of the same app in one browser can be told apart.
 */
export const INSTANCE_NAME: string | null = resolveBrandText(
  "instance-name",
  __BRANDING__.instanceName,
);

/**
 * The instance's own logo, next to its name in About and, when the top bar
 * carries the instance (see {@link HEADER_BRAND}), there and in the tab.
 */
export const INSTANCE_LOGO: Logo | null = resolveLogo(
  "instance-logo",
  { light: __BRANDING__.instanceLogo, dark: __BRANDING__.instanceLogoDark },
  false,
);

/** Who owns this copy ("Acme Inc"), on the sign-in screen and in About. */
export const ORG_NAME: string | null = resolveBrandText(
  "org-name",
  __BRANDING__.orgName,
);

/** The organisation's logo, beside its name. */
export const ORG_LOGO: Logo | null = resolveLogo(
  "org-logo",
  { light: __BRANDING__.orgLogo, dark: __BRANDING__.orgLogoDark },
  false,
);

/**
 * Whose name the top bar carries: `instance` if the `header-brand` meta tag or
 * `VITE_HEADER_BRAND` says so and there is an instance name to carry, `app`
 * otherwise. The app keeps its place in About either way.
 */
export function resolveHeaderBrand(
  fallback: string,
  instanceName: string | null,
): "app" | "instance" {
  const wanted = (metaValue("header-brand") ?? fallback).toLowerCase();
  return wanted === "instance" && instanceName ? "instance" : "app";
}

/**
 * The top bar's mark and name on the Notes view. An instance without a logo
 * shows its name alone.
 */
export const HEADER_BRAND: {
  name: string;
  logo: Logo | null;
  /** The instance is the brand, so it is not repeated beside it. */
  isInstance: boolean;
} =
  resolveHeaderBrand(__BRANDING__.headerBrand, INSTANCE_NAME) === "instance"
    ? { name: INSTANCE_NAME as string, logo: INSTANCE_LOGO, isInstance: true }
    : { name: APP_NAME, logo: APP_LOGO, isInstance: false };

/**
 * The tab's icon, when it is not the page's own `favicon.svg`: the instance's
 * logo, once the instance is the brand the top bar carries. Null otherwise.
 */
export const FAVICON: Logo | null = HEADER_BRAND.isInstance
  ? HEADER_BRAND.logo
  : null;

/**
 * Points the page's icon at `logo`. The link's `type` goes, since the logo
 * need not be an SVG and a wrong one makes the browser skip the icon.
 *
 * A dark variant is a second link for the browser's dark scheme. The tab is
 * the browser's, not the page's, so it follows the browser's scheme rather
 * than the app's theme setting, which nothing outside the page can see.
 */
export function applyFavicon(logo: Logo | null, doc: Document = document) {
  if (!logo) return;
  const link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  link.removeAttribute("type");
  link.href = logo.light;
  if (!logo.dark) return;
  link.media = "(prefers-color-scheme: light)";
  const dark = link.cloneNode() as HTMLLinkElement;
  dark.href = logo.dark;
  dark.media = "(prefers-color-scheme: dark)";
  link.after(dark);
}

/**
 * The window title: the instance first, since that is what tells tabs apart,
 * then the app's name unless `VITE_TITLE_APP_NAME` or the `title-app-name`
 * meta tag says `off`. With no instance there is only the app's name to use,
 * whatever the setting says, since a title cannot be empty.
 */
export function windowTitle(
  appName: string,
  instanceName: string | null,
  fallbackWithAppName: boolean,
): string {
  if (!instanceName) return appName;
  const tag = metaValue("title-app-name")?.toLowerCase();
  const withAppName =
    tag === "off" || tag === "false"
      ? false
      : tag === "on" || tag === "true"
        ? true
        : fallbackWithAppName;
  return withAppName ? `${instanceName} · ${appName}` : instanceName;
}

export const WINDOW_TITLE: string = windowTitle(
  APP_NAME,
  INSTANCE_NAME,
  __BRANDING__.titleAppName,
);
