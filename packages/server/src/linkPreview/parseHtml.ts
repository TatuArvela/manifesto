/**
 * Reads a page's preview metadata out of its HTML.
 *
 * This is not an HTML parser and does not try to be one: it scans tags with
 * regular expressions, which is enough for `<meta>`, `<link>` and `<title>` in
 * a document's head. The input is attacker-controlled, so every quantifier is
 * bounded; an unbounded one over a crafted page is how a regex pins a CPU.
 */

export interface PageMetadata {
  title?: string;
  description?: string;
  /** Absolute http(s) URL. */
  image?: string;
  /** Absolute http(s) URL. */
  favicon?: string;
}

const TAG_RE = /<(meta|link)\b([^<>]{0,4096})>/gi;
const ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]{0,64})\s{0,8}=\s{0,8}(?:"([^"]{0,4096})"|'([^']{0,4096})'|([^\s"'=<>`]{1,4096}))/g;
const TITLE_RE = /<title\b[^<>]{0,256}>([^<]{0,4096})</i;
const BASE_RE =
  /<base\b[^<>]{0,1024}\bhref\s{0,8}=\s{0,8}["']([^"']{1,2048})["']/i;
const ENTITY_RE = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function extractMetadata(html: string, pageUrl: URL): PageMetadata {
  const headEnd = html.search(/<\/head\s{0,8}>/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);

  const meta = new Map<string, string>();
  const icons: string[] = [];
  const touchIcons: string[] = [];

  for (const match of head.matchAll(TAG_RE)) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttributes(match[2]);
    if (tag === "meta") {
      const key = (attrs.property ?? attrs.name)?.toLowerCase();
      const content = attrs.content;
      // First one wins, as it does for the crawlers that define these tags.
      if (key && content !== undefined && !meta.has(key)) {
        meta.set(key, content);
      }
      continue;
    }
    const rel = attrs.rel?.toLowerCase().split(/\s{1,8}/) ?? [];
    if (!attrs.href) continue;
    if (rel.includes("icon")) icons.push(attrs.href);
    else if (rel.includes("apple-touch-icon")) touchIcons.push(attrs.href);
  }

  const baseHref = BASE_RE.exec(head)?.[1];
  const base =
    absoluteUrl(
      baseHref === undefined ? undefined : decodeEntities(baseHref),
      pageUrl,
    ) ?? pageUrl;

  const titleTag = TITLE_RE.exec(head)?.[1];
  const title = firstText(
    meta.get("og:title"),
    meta.get("twitter:title"),
    titleTag === undefined ? undefined : decodeEntities(titleTag),
  );
  const description = firstText(
    meta.get("og:description"),
    meta.get("twitter:description"),
    meta.get("description"),
  );
  const image = firstUrl(base, [
    meta.get("og:image:secure_url"),
    meta.get("og:image:url"),
    meta.get("og:image"),
    meta.get("twitter:image"),
    meta.get("twitter:image:src"),
  ]);
  const favicon =
    firstUrl(base, [...icons, ...touchIcons]) ??
    new URL("/favicon.ico", pageUrl).href;

  return {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(image !== undefined && { image }),
    favicon,
  };
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function decodeEntities(text: string): string {
  return text.replace(ENTITY_RE, (whole, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const code = Number.parseInt(dec ?? hex, dec !== undefined ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function firstText(...candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const text = candidate?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return undefined;
}

function firstUrl(
  base: URL,
  candidates: (string | undefined)[],
): string | undefined {
  for (const candidate of candidates) {
    const url = absoluteUrl(candidate, base);
    if (url) return url.href;
  }
  return undefined;
}

function absoluteUrl(value: string | undefined, base: URL): URL | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The page's character encoding: the `Content-Type` header if it names one,
 * else a `<meta charset>` near the top, else UTF-8.
 */
export function decodeHtml(body: Buffer, contentType: string): string {
  const fromHeader = /charset\s{0,8}=\s{0,8}["']?([\w-]{1,40})/i.exec(
    contentType,
  )?.[1];
  const sniffed = body.subarray(0, 2048).toString("latin1");
  const fromMeta =
    /<meta\b[^<>]{0,512}charset\s{0,8}=\s{0,8}["']?([\w-]{1,40})/i.exec(
      sniffed,
    )?.[1];
  for (const label of [fromHeader, fromMeta]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // not an encoding this runtime knows; try the next source
    }
  }
  return new TextDecoder("utf-8").decode(body);
}
