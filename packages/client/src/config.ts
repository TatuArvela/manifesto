import { resolvePrivacyUrl } from "./utils/privacyUrl.ts";

/**
 * Branding: the product name that users see.
 *
 * There are two ways to set it, so that both types of self-hoster can do it:
 *
 * - **Build from source**: set `VITE_APP_NAME`. `vite.config.ts` resolves it
 *   one time. It reaches the bundle as `__APP_NAME__`, `index.html` as the
 *   `<title>` and the `application-name` meta tag, and `manifest.webmanifest`
 *   as `name`/`short_name`.
 * - **Deploy the release zip**: edit the `application-name` meta tag in the
 *   shipped `index.html` (and the `<title>` and the manifest, which are plain
 *   text in the same folder). Nobody must need a toolchain to rename an app,
 *   and the JS bundle is minified too much for a safe manual edit.
 *
 * The meta tag wins when it is present. Thus, an edited bundle overrides the
 * value with which it was built. All parts after it (the header, the login
 * screen, the names of downloaded files, and each translated string that
 * contains `{appName}`) follow from {@link APP_NAME}.
 */

/**
 * The build-time token without substitution, in case the raw template is
 * served.
 */
const PLACEHOLDER = "%APP_NAME%";

/**
 * The `application-name` meta tag if the document has a usable one. Otherwise
 * `fallback` (the name from the build). Exported for the tests, which cannot
 * import this module again with a different document.
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
 * If the welcome dialog greets a first-time visitor. It tells what the app is
 * and, most important, where their notes are kept.
 *
 * On by default. `VITE_APP_WELCOME=off` at build time switches it off. In a
 * release bundle, set the `welcome-dialog` meta tag in `index.html` to `off`.
 * This is for the same reason as for the name: an operator must not need a
 * toolchain for it. The tag wins when it contains a value that the code knows.
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

/**
 * The build-time token without substitution, in case the raw template is
 * served.
 */
const SERVER_PLACEHOLDER = "%MANIFESTO_SERVER%";

function usableServer(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === SERVER_PLACEHOLDER) return null;
  return trimmed;
}

/**
 * The Manifesto server of this deployment, or null for open mode.
 *
 * There are two ways to set it, the same pair as for the product name:
 *
 * - **Build from source**: set `VITE_MANIFESTO_SERVER`. `vite.config.ts` also
 *   adds the HTTP and `ws(s)://` origins of the server to the `connect-src` in
 *   `index.html`. Thus, the address and the policy always agree.
 * - **Deploy the release zip**: fill the `manifesto-server` meta tag in the
 *   shipped `index.html`. That alone is not sufficient, because the CSP in the
 *   same file still says `connect-src 'self'`, and the browser blocks each
 *   request until the origins of the server are also added there. `main.tsx`
 *   checks for exactly that mismatch at startup and tells it, because the
 *   alternative is a login screen that fails with no explanation. See
 *   `utils/serverCsp.ts`.
 *
 * The tag wins when it contains a value. Thus, an edited bundle overrides the
 * value with which it was built. Empty, absent, or a placeholder without
 * substitution means open mode. The published zip ships so, and stays so if
 * nobody changes the tag.
 *
 * The code removes a slash at the end. Thus, `https://notes.example.com/` and
 * the same address without the slash agree. Thus, `/` resolves to the empty
 * string, not to null. That is the same-origin case, on purpose: requests go to
 * the own origin of this page, and `'self'` already permits them.
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
 * The server as an absolute URL, resolved as the browser would do it.
 *
 * {@link resolveServerUrl} keeps the configured value, which can be relative
 * (`/`, or `/notes` behind a proxy that removes the path). That is the correct
 * base for `fetch`, which resolves it against the page. It is not sufficient
 * for all callers: `new WebSocket("/api/v1/ws")` does not work, and the welcome
 * dialog must name a host. Those callers use this.
 *
 * Null in open mode, and null when there is no document against which to
 * resolve a relative value, which is the case for each caller that is not a
 * browser.
 */
export function resolveServerOrigin(serverUrl: string | null): string | null {
  if (serverUrl === null) return null;
  if (/^https?:\/\//i.test(serverUrl)) return serverUrl;
  if (typeof window === "undefined") return null;
  return `${window.location.origin}${serverUrl}`;
}

/**
 * Changes a product name into a value that is safe in a filename. The code
 * folds diacritics, and does not drop them. Thus, "Müistiö" becomes `muistio`.
 * If a name has no ASCII letters or digits after the fold (for example, a name
 * only in CJK), it becomes `notes`. Thus, downloads never get the name
 * `-export-2026-01-01.json`.
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

/**
 * The prefix for exports and crash backups
 * (`manifesto-export-2026-01-01.json`).
 */
export const APP_FILE_SLUG: string = toFileSlug(APP_NAME);

/**
 * The value of a branding meta tag, or null when the document has none, it is
 * empty, or it still contains a `%PLACEHOLDER%` because the raw template is
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
 * One of the own names of the deployment: the meta tag if it contains one,
 * otherwise the value of the build, otherwise null for a deployment that did
 * not set it. The same pair of paths as {@link resolveAppName}, for the same
 * reason.
 */
export function resolveBrandText(tag: string, fallback: string): string | null {
  return metaValue(tag) ?? (fallback.trim() || null);
}

/**
 * A branding image as a URL that the page can load. A bare file name is a file
 * next to `index.html`. Thus, it gets the base prefix for a subpath deployment.
 * An absolute path or a `data:` URL is used as it is. A remote `https:` URL is
 * also used as it is, but the `img-src 'self'` of the page then refuses it. For
 * this reason, the docs tell you to ship the file with the build.
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
 * dark, if the deployment gave one. Without it, `invertInDark` tells if `light`
 * is inverted there (the mark of the app is, as a shape with one color. The
 * logo of an instance or organization keeps its colors).
 */
export interface Logo {
  light: string;
  dark: string | null;
  invertInDark: boolean;
}

/**
 * A logo from its meta tags (`<tag>` and `<tag>-dark`) or the values of the
 * build, or null when there is no light logo to draw. A dark variant alone
 * replaces nothing.
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
 * The mark of the app: the header, the sign-in screen, the welcome dialog,
 * About. It is a plain file with a fixed name next to `index.html`, not a
 * hashed import. Thus, its replacement is the same type of job as the
 * replacement of the favicon. `logo.svg`, unless `VITE_APP_LOGO` or the
 * `app-logo` meta tag names a different file.
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
 * The purpose of this copy, when a deployment names it ("Foo QA project"). It
 * shows next to the name of the app in the header and the tab, and on the
 * sign-in screen. Thus, you can tell two instances of the same app in one
 * browser apart.
 */
export const INSTANCE_NAME: string | null = resolveBrandText(
  "instance-name",
  __BRANDING__.instanceName,
);

/**
 * The own logo of the instance, next to its name in About and, when the top bar
 * shows the instance (see {@link HEADER_BRAND}), there and in the tab.
 */
export const INSTANCE_LOGO: Logo | null = resolveLogo(
  "instance-logo",
  { light: __BRANDING__.instanceLogo, dark: __BRANDING__.instanceLogoDark },
  false,
);

/** The owner of this copy ("Acme Inc"), on the sign-in screen and in About. */
export const ORG_NAME: string | null = resolveBrandText(
  "org-name",
  __BRANDING__.orgName,
);

/**
 * The location of the privacy notice of the operator: who has what, for how
 * long, and how to ask for it. The sign-in screen, where accounts are made, and
 * About link to it. Null when the deployment did not set one.
 */
export const PRIVACY_URL: string | null = resolvePrivacyUrl(
  resolveBrandText("privacy-url", __BRANDING__.privacyUrl),
);

/** The logo of the organization, next to its name. */
export const ORG_LOGO: Logo | null = resolveLogo(
  "org-logo",
  { light: __BRANDING__.orgLogo, dark: __BRANDING__.orgLogoDark },
  false,
);

/**
 * The name that the top bar shows: `instance` if the `header-brand` meta tag or
 * `VITE_HEADER_BRAND` says so and there is an instance name to show, otherwise
 * `app`. The app keeps its place in About in both cases.
 */
export function resolveHeaderBrand(
  fallback: string,
  instanceName: string | null,
): "app" | "instance" {
  const wanted = (metaValue("header-brand") ?? fallback).toLowerCase();
  return wanted === "instance" && instanceName ? "instance" : "app";
}

/**
 * The mark and name of the top bar on the Notes view. An instance without a
 * logo shows only its name.
 */
export const HEADER_BRAND: {
  name: string;
  logo: Logo | null;
  /** The instance is the brand. Thus, it does not repeat next to it. */
  isInstance: boolean;
} =
  resolveHeaderBrand(__BRANDING__.headerBrand, INSTANCE_NAME) === "instance"
    ? { name: INSTANCE_NAME as string, logo: INSTANCE_LOGO, isInstance: true }
    : { name: APP_NAME, logo: APP_LOGO, isInstance: false };

/**
 * The icon of the tab, when it is not the own `favicon.svg` of the page: the
 * logo of the instance, when the instance is the brand of the top bar. Null
 * otherwise.
 */
export const FAVICON: Logo | null = HEADER_BRAND.isInstance
  ? HEADER_BRAND.logo
  : null;

/**
 * Points the icon of the page to `logo`. The `type` of the link goes, because
 * the logo does not have to be an SVG, and a wrong type makes the browser skip
 * the icon.
 *
 * A dark variant follows the color scheme of the browser, which the tab around
 * the icon also follows. The code changes the `href` of the one link when the
 * scheme changes. It does not use a second link with a `media` attribute. A
 * browser that ignores `media` on an icon, or finds no matching link, showed no
 * icon.
 */
export function applyFavicon(
  logo: Logo | null,
  doc: Document = document,
  darkScheme: Pick<
    MediaQueryList,
    "matches" | "addEventListener"
  > | null = typeof matchMedia === "function"
    ? matchMedia("(prefers-color-scheme: dark)")
    : null,
) {
  if (!logo) return;
  const link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  link.removeAttribute("type");
  link.href = logo.light;
  const dark = logo.dark;
  if (!dark || !darkScheme) return;
  const follow = () => {
    link.href = darkScheme.matches ? dark : logo.light;
  };
  follow();
  darkScheme.addEventListener("change", follow);
}

/**
 * The window title: the instance first, because that tells tabs apart, then the
 * name of the app, unless `VITE_TITLE_APP_NAME` or the `title-app-name` meta
 * tag says `off`. With no instance, there is only the name of the app to use,
 * whatever the setting says, because a title cannot be empty.
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
