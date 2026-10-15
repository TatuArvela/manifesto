/**
 * A privacy notice's address as a link may carry it: an `http(s):` URL, or a
 * path on this site. Anything else (a `javascript:` URL, a typo) is no link
 * at all rather than one that does something other than open a page.
 */
export function resolvePrivacyUrl(value: string | null): string | null {
  if (value === null) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
