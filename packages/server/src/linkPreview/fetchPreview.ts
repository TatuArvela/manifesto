import type { LinkPreview } from "@manifesto/shared";
import { logger } from "../lib/logger.js";
import {
  MAX_LINK_PREVIEW_DESCRIPTION_LENGTH,
  MAX_LINK_PREVIEW_TITLE_LENGTH,
} from "../validation/schemas.js";
import { decodeHtml, extractMetadata } from "./parseHtml.js";
import { type SafeFetchOptions, safeFetch } from "./safeFetch.js";

/**
 * Most bytes read of a linked page's image. The client shrinks it to a small
 * thumbnail anyway, so this only bounds the fetch; it is its own number rather
 * than the attachment limit, which is sized for photos people attach.
 */
const MAX_PREVIEW_IMAGE_SOURCE_BYTES = 1.5 * 1024 * 1024;

export type LinkPreviewFetcher = (url: string) => Promise<LinkPreview | null>;

/** Test seams passed through to every fetch this makes. */
export type FetchPolicy = Pick<
  SafeFetchOptions,
  "isAllowedAddress" | "allowAnyPort" | "timeoutMs"
>;

/** A page's metadata is in its head; nothing past this is read. */
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_FAVICON_BYTES = 256 * 1024;

const HTML_TYPES = /^\s{0,8}(?:text\/html|application\/xhtml\+xml)\b/i;

/**
 * Builds a preview for a URL: its title and description, plus its image and
 * favicon as `data:` URLs. Resolves to null when the page itself cannot be
 * had; a missing image or favicon only leaves that field out.
 */
export function createLinkPreviewFetcher(
  policy: FetchPolicy = {},
): LinkPreviewFetcher {
  return async (rawUrl) => {
    const url = new URL(rawUrl);
    let page: Awaited<ReturnType<typeof safeFetch>>;
    try {
      page = await safeFetch(url, {
        ...policy,
        maxBytes: MAX_PAGE_BYTES,
        overflow: "truncate",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      });
    } catch (err) {
      logRefusal("page", url, err);
      return null;
    }
    if (!HTML_TYPES.test(page.contentType)) return null;

    const metadata = extractMetadata(
      decodeHtml(page.body, page.contentType),
      page.url,
    );
    const [image, favicon] = await Promise.all([
      metadata.image
        ? fetchImage(metadata.image, MAX_PREVIEW_IMAGE_SOURCE_BYTES, policy)
        : undefined,
      metadata.favicon
        ? fetchImage(metadata.favicon, MAX_FAVICON_BYTES, policy)
        : undefined,
    ]);

    const description = metadata.description?.slice(
      0,
      MAX_LINK_PREVIEW_DESCRIPTION_LENGTH,
    );
    return {
      url: rawUrl,
      title: (metadata.title ?? rawUrl).slice(0, MAX_LINK_PREVIEW_TITLE_LENGTH),
      ...(description && { description }),
      ...(image && { image }),
      ...(favicon && { favicon }),
      domain: url.host,
    };
  };
}

async function fetchImage(
  href: string,
  maxBytes: number,
  policy: FetchPolicy,
): Promise<string | undefined> {
  const url = new URL(href);
  try {
    const res = await safeFetch(url, {
      ...policy,
      maxBytes,
      overflow: "refuse",
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
    });
    const type = sniffImageType(res.body);
    if (!type) return undefined;
    return `data:${type};base64,${res.body.toString("base64")}`;
  } catch (err) {
    logRefusal("image", url, err);
    return undefined;
  }
}

/**
 * The image's real type, read from its first bytes. The `Content-Type` header
 * is not trusted: favicons in particular are routinely served as
 * `application/octet-stream` or `text/plain`, and a page that points its
 * `og:image` at an HTML document should get no image rather than a `data:`
 * URL claiming to be one. SVG is not recognized on purpose; see
 * `IMAGE_DATA_URL_SUBTYPES`.
 */
export function sniffImageType(bytes: Buffer): string | undefined {
  const ascii = (start: number, end: number) =>
    bytes.subarray(start, end).toString("latin1");
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) {
    return "image/avif";
  }
  if (
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    (bytes[2] === 1 || bytes[2] === 2) &&
    bytes[3] === 0
  ) {
    return "image/x-icon";
  }
  return undefined;
}

function logRefusal(what: string, url: URL, err: unknown) {
  // A page that is down, slow or private is an ordinary outcome, not a server
  // fault, so it stays out of the error log.
  logger.debug(`Link preview ${what} not fetched`, {
    host: url.host,
    reason: err instanceof Error ? err.message : String(err),
  });
}
