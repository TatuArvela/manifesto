/**
 * The addresses to which an OAuth client can have the browser sent back. The
 * consent page goes to it. Thus, this prevents a registration from making that
 * page a script runner (`javascript:`) or a reader of local files.
 */

/**
 * Schemes to which a browser gives its own meaning. No client listens on them.
 */
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
 * Why a client cannot name this address, or null if it can. It can name
 * `https`, `http` only to this computer (a desktop assistant that listens on a
 * port, RFC 8252), or its own scheme (`cursor://`, `com.example.app:`), which
 * the system gives to the app that claimed it.
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
 * If `given` is one of the addresses that a client registered. It must be
 * exact, but a loopback address can come back on a different port. A desktop
 * app takes the port that is free when it starts to listen (RFC 8252, section
 * 7.3).
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
