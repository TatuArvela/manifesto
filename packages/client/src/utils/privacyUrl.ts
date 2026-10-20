/**
 * The address of a privacy notice, as a link can carry it: an `http(s):` URL,
 * or a path on this site. All other values (a `javascript:` URL, a typing
 * error) are no link, and not a link that does something other than open a
 * page.
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
