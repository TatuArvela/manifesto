import type { LinkPreview } from "@manifesto/shared";

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
