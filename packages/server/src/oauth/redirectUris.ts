/**
 * Where an OAuth client may have the browser sent back to. The consent page
 * navigates to it, so this is what keeps a registration from turning that
 * page into a script runner (`javascript:`) or a reader of local files.
 */

/** Schemes a browser gives meaning of its own, which no client listens on. */
const REFUSED_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
  "filesystem:",
  "ws:",
  "wss:",
  "ftp:",
]);

export const MAX_REDIRECT_URI_LENGTH = 2000;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Why a client may not name this address, or null if it may: `https`, `http`
 * to this computer only (a desktop assistant listening on a port, RFC 8252),
 * or a scheme of the client's own (`cursor://`, `com.example.app:`), which
 * the system hands to the app that claimed it.
 */
export function redirectUriProblem(text: string): string | null {
  if (text.length > MAX_REDIRECT_URI_LENGTH) return "is too long";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "is not an absolute address";
  }
  if (url.hash) return "has a fragment";
  if (url.username || url.password) return "carries credentials";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:") {
    return isLoopbackHost(url.hostname)
      ? null
      : "uses http to somewhere other than this computer";
  }
  if (REFUSED_SCHEMES.has(url.protocol)) return "uses a refused scheme";
  return null;
}

/**
 * Whether `given` is one of the addresses a client registered. Exact, except
 * that a loopback address may come back on another port: a desktop app takes
 * whichever port is free when it starts listening (RFC 8252, section 7.3).
 */
export function redirectUriMatches(
  registered: readonly string[],
  given: string,
): boolean {
  if (registered.includes(given)) return true;
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || !isLoopbackHost(url.hostname)) return false;
  url.port = "";
  return registered.some((candidate) => {
    let other: URL;
    try {
      other = new URL(candidate);
    } catch {
      return false;
    }
    if (other.protocol !== "http:" || !isLoopbackHost(other.hostname)) {
      return false;
    }
    other.port = "";
    return other.href === url.href;
  });
}
