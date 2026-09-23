import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { isPublicAddress } from "./addressPolicy.js";

export interface SafeFetchOptions {
  /** Most bytes to read, after decompression. */
  maxBytes: number;
  /**
   * What to do with a body longer than `maxBytes`: a page's metadata is at the
   * top, so its first bytes are still useful, while a cut-off image is not.
   */
  overflow: "truncate" | "refuse";
  accept: string;
  /** Deadline for the whole exchange: DNS, every redirect, and the body. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Test seam. Production refuses anything but public addresses. */
  isAllowedAddress?: (address: string) => boolean;
  /** Test seam. Production accepts only a scheme's default port. */
  allowAnyPort?: boolean;
  /** GET unless given. A request with a body is never redirected: a 3xx is
   * returned as it is, since resending a body elsewhere is not the caller's
   * to assume. */
  method?: "GET" | "POST";
  body?: Buffer;
  headers?: Record<string, string>;
  /** Which final statuses count as success; 200 only unless given. */
  acceptStatus?: (status: number) => boolean;
}

export interface FetchedResource {
  /** Where the body actually came from, after redirects. */
  url: URL;
  status: number;
  contentType: string;
  body: Buffer;
}

export class FetchRefused extends Error {
  /** The HTTP status, when refused for one. */
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; ManifestoLinkPreview/1.0; +https://github.com/TatuArvela/manifesto)";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * GET a user-supplied URL without letting it reach anything private.
 *
 * The address is checked after DNS resolution and the connection is then made
 * to that exact address, through `lookup`, rather than handing the hostname to
 * the HTTP client to resolve again. Resolving twice would let a hostname answer
 * with a public address for the check and a private one for the connection
 * (DNS rebinding). Every redirect goes through the same check, since a public
 * page can redirect anywhere.
 */
export async function safeFetch(
  url: URL,
  options: SafeFetchOptions,
): Promise<FetchedResource> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new FetchRefused("Timed out")),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    let current = url;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    for (let hop = 0; ; hop++) {
      const res = await request(current, options, controller.signal);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && !options.body) {
        res.resume();
        if (hop >= maxRedirects) throw new FetchRefused("Too many redirects");
        current = new URL(location, current);
        continue;
      }
      const accepted = options.acceptStatus ?? ((s: number) => s === 200);
      if (!accepted(status)) {
        res.resume();
        throw new FetchRefused(`Status ${status}`, status);
      }
      const body = await readBody(res, options, controller.signal);
      return {
        url: current,
        status,
        contentType: String(res.headers["content-type"] ?? ""),
        body,
      };
    }
  } catch (err) {
    // The HTTP client reports an abort as its own generic error; the reason
    // given to `abort()` is the one that says what happened.
    throw controller.signal.aborted ? controller.signal.reason : err;
  } finally {
    clearTimeout(timer);
  }
}

async function request(
  url: URL,
  options: SafeFetchOptions,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchRefused("Only http(s) URLs are fetched");
  }
  if (url.username || url.password) {
    throw new FetchRefused("URLs with credentials are not fetched");
  }
  if (url.port !== "" && !options.allowAnyPort) {
    throw new FetchRefused("Only default ports are fetched");
  }
  const address = await resolveAllowed(url.hostname, options, signal);
  // The one address that passed the check is the only one this socket may
  // use, whatever the hostname would resolve to by now.
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    const family = isIP(address);
    if (lookupOptions.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
  const client = url.protocol === "https:" ? https : http;
  return await new Promise<IncomingMessage>((resolve, reject) => {
    const req = client.request(url, {
      method: options.method ?? "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: options.accept,
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en;q=0.9, *;q=0.5",
        ...options.headers,
        ...(options.body && { "Content-Length": String(options.body.length) }),
      },
      lookup: pinnedLookup,
      signal,
    });
    req.on("response", resolve);
    req.on("error", reject);
    req.end(options.body);
  });
}

async function resolveAllowed(
  hostname: string,
  options: SafeFetchOptions,
  signal: AbortSignal,
): Promise<string> {
  const isAllowed = options.isAllowedAddress ?? isPublicAddress;
  // `URL` keeps the brackets around an IPv6 literal.
  const bare = hostname.replace(/^\[(.*)\]$/, "$1");
  const addresses = isIP(bare)
    ? [bare]
    : (
        await abortable(dnsLookup(bare, { all: true, verbatim: true }), signal)
      ).map((entry) => entry.address);
  // Every answer must pass, not just the first: which one a later lookup
  // would have used is not something to leave to chance.
  if (addresses.length === 0 || !addresses.every(isAllowed)) {
    throw new FetchRefused("Address is not public");
  }
  return addresses[0];
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function decoded(res: IncomingMessage): Readable {
  switch (String(res.headers["content-encoding"] ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return res.pipe(zlib.createGunzip());
    case "deflate":
      return res.pipe(zlib.createInflate());
    case "br":
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
}

/**
 * Reads at most `maxBytes` of the decompressed body. The limit is applied to
 * what comes out of the decompressor, not to what goes in, so a small
 * compressed response cannot expand into gigabytes in memory.
 */
async function readBody(
  res: IncomingMessage,
  options: SafeFetchOptions,
  signal: AbortSignal,
): Promise<Buffer> {
  const stream = decoded(res);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      if (signal.aborted) throw signal.reason;
      const buf = chunk as Buffer;
      const room = options.maxBytes - total;
      if (buf.length > room) {
        if (options.overflow === "refuse") {
          throw new FetchRefused("Response too large");
        }
        chunks.push(buf.subarray(0, room));
        total += room;
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
  } finally {
    res.destroy();
    if (stream !== res) stream.destroy();
  }
  return Buffer.concat(chunks, total);
}
