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

/** The name the project ships under. Mirrors the default in `vite.config.ts`. */
export const DEFAULT_APP_NAME = "Manifesto";

/**
 * Whether this deployment still goes by the default name. Only then may a
 * message spell the name out the way its language says it (Finnish
 * "Tervetuloa Manifestoon"), through a `.unbranded` variant of a key that
 * otherwise carries `{appName}`. A rebranded name cannot be inflected, since a
 * translation cannot know how it declines.
 */
export const IS_UNBRANDED: boolean = APP_NAME === DEFAULT_APP_NAME;

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
 * The header logo. It lives in `public/` rather than `src/assets/` so that it
 * is a plain file at a predictable path in a built bundle: replacing the brand
 * mark is then the same kind of job as replacing the favicon, with no build
 * step and no content hash to chase. Base-prefixed for subpath deployments.
 */
export const APP_LOGO_URL: string = `${import.meta.env.BASE_URL}logo.svg`;
