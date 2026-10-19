import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { isPublicAddress } from "./addressPolicy.ts";

export interface SafeFetchOptions {
  /** The maximum bytes to read, after decompression. */
  maxBytes: number;
  /**
   * What to do with a body longer than `maxBytes`. The metadata of a page is at
   * the top. Thus, its first bytes are still useful. A cut-off image is not.
   */
  overflow: "truncate" | "refuse";
  accept: string;
  /** The deadline for the full exchange: DNS, each redirect, and the body. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Test seam. Production refuses all addresses that are not public. */
  isAllowedAddress?: ((address: string) => boolean) | undefined;
  /** Test seam. Production accepts only the default port of a scheme. */
  allowAnyPort?: boolean;
  /**
   * GET, unless a different method is given. A request with a body is never
   * redirected. A 3xx returns as it is, because the caller did not ask to send
   * a body to a different place.
   */
  method?: "GET" | "POST";
  body?: Buffer;
  headers?: Record<string, string>;
  /**
   * The final statuses that count as success. Only 200, unless others are
   * given.
   */
  acceptStatus?: (status: number) => boolean;
}

export interface FetchedResource {
  /** The real source of the body, after redirects. */
  url: URL;
  status: number;
  contentType: string;
  body: Buffer;
}

export class FetchRefused extends Error {
  /** The HTTP status, when the refusal is for a status. */
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
 * GET a URL that a user supplied, without access to anything private.
 *
 * The code checks the address after DNS resolution. Then it makes the
 * connection to that exact address, through `lookup`. It does not give the
 * hostname to the HTTP client to resolve again. A second resolution would let a
 * hostname answer with a public address for the check and a private address for
 * the connection (DNS rebinding). Each redirect goes through the same check,
 * because a public page can redirect to any place.
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
    // The HTTP client reports an abort as its own generic error. The reason
    // given to `abort()` tells what occurred.
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
  // The one address that passed the check is the only address that this socket
  // can use, whatever the hostname resolves to now.
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
  // Each answer must pass, not only the first. Do not let chance decide which
  // answer a later lookup uses.
  const [first] = addresses;
  if (first === undefined || !addresses.every(isAllowed)) {
    throw new FetchRefused("Address is not public");
  }
  return first;
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
 * Reads a maximum of `maxBytes` of the decompressed body. The limit applies to
 * the output of the decompressor, not to its input. Thus, a small compressed
 * response cannot expand into gigabytes in memory.
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
