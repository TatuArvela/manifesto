import {
  IMAGE_DATA_URL_PATTERN,
  type LinkPreview,
  MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES,
  MAX_LINK_PREVIEW_URL_LENGTH,
  MAX_LINK_PREVIEWS_PER_NOTE,
} from "@manifesto/shared";

const URL_RE = /https?:\/\/[^\s<>'"`]+/gi;
// Bounded quantifier: an unbounded `+` backtracks quadratically on a long
// punctuation run that is not at the end (15.7s for a 120k-char note), and
// `extractUrls` runs during note-card render. Eight is well past any real URL.
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}>"'*_]{1,8}$/;

export function extractUrls(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const matches = text.match(URL_RE) ?? [];
  for (const raw of matches) {
    const cleaned = raw.replace(TRAILING_PUNCTUATION_RE, "");
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

export function normalizeDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  }
}

export function makeStubPreview(url: string): LinkPreview {
  return { url, title: url, domain: normalizeDomain(url) };
}

export interface AppendedPreviews {
  previews: LinkPreview[];
  /** The URLs that got a new card, in order. */
  added: string[];
  /** Whether some URLs were left out because the note was full. */
  overflow: boolean;
}

/**
 * Adds a plain card for each new URL, all at once.
 *
 * One paste can carry many links, and building the list per URL from the same
 * starting note would keep only the last of them. Duplicates and
 * URLs the server would refuse are skipped, and the list stops at the per-note
 * cap, since a note over it fails to save in connected mode.
 */
export function appendStubPreviews(
  existing: LinkPreview[],
  urls: string[],
): AppendedPreviews {
  const previews = [...existing];
  const seen = new Set(existing.map((p) => p.url));
  const added: string[] = [];
  let overflow = false;
  for (const url of urls) {
    if (seen.has(url) || !isPreviewableUrl(url)) continue;
    if (previews.length >= MAX_LINK_PREVIEWS_PER_NOTE) {
      overflow = true;
      break;
    }
    seen.add(url);
    previews.push(makeStubPreview(url));
    added.push(url);
  }
  return { previews, added, overflow };
}

function isPreviewableUrl(url: string): boolean {
  return (
    url.length <= MAX_LINK_PREVIEW_URL_LENGTH && /^https?:\/\/[^/]/i.test(url)
  );
}

function isPreviewImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES &&
    IMAGE_DATA_URL_PATTERN.test(value)
  );
}

/**
 * The link previews of an imported note, checked field by field. An import is
 * a file from anywhere, so a preview's `url` ends up in an `href` only if it is
 * http(s), and an image survives only as an inlined image the client could
 * have produced itself; a remote image URL is dropped, since the CSP would
 * refuse to load it anyway.
 */
export function parseLinkPreviews(raw: unknown): LinkPreview[] {
  if (!Array.isArray(raw)) return [];
  const previews: LinkPreview[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (previews.length >= MAX_LINK_PREVIEWS_PER_NOTE) break;
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.url !== "string" || !isPreviewableUrl(p.url)) continue;
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    previews.push({
      url: p.url,
      title: typeof p.title === "string" ? p.title : p.url,
      ...(typeof p.description === "string" && {
        description: p.description,
      }),
      ...(isPreviewImage(p.image) && { image: p.image }),
      ...(isPreviewImage(p.favicon) && { favicon: p.favicon }),
      domain: typeof p.domain === "string" ? p.domain : normalizeDomain(p.url),
    });
  }
  return previews;
}
