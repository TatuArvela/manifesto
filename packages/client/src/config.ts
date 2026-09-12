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
