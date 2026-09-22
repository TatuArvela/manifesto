/**
 * Does this page's own Content Security Policy allow it to reach the server
 * it is configured for?
 *
 * The question exists because a connected deployment is two settings in one
 * `index.html`: the server's address, and the `connect-src` that lets the
 * browser dial it. A build from source writes both (`vite.config.ts` derives
 * the CSP from `VITE_MANIFESTO_SERVER`), but someone pointing a release
 * bundle at a server edits them by hand, and the second is the one that gets
 * forgotten. Without this check the symptom is a login screen that never
 * works and a console full of CSP violations, which says nothing about the
 * edit that was missed.
 *
 * Everything here is deliberately fail-open. A page with no CSP of its own,
 * or none that mentions `connect-src`, is not a page this can judge, and a
 * false alarm would take down a deployment that works. The case worth
 * catching is unambiguous: a server on another origin against the shipped
 * `connect-src 'self'`.
 */

export type ServerSetupProblem =
  | { kind: "invalid-url"; serverUrl: string }
  | { kind: "csp-blocked"; serverUrl: string; missing: string[] };

interface Origin {
  scheme: string;
  host: string;
}

function splitOrigin(origin: string): Origin | null {
  const mark = origin.indexOf("://");
  if (mark === -1) return null;
  return { scheme: origin.slice(0, mark + 1), host: origin.slice(mark + 3) };
}

/**
 * The origins a client must be allowed to connect to in order to talk to
 * `serverUrl`: the HTTP one for REST, and the `ws(s)` one for `/api/ws` and
 * `/api/yjs`. Empty when the server is this page's own origin and `'self'`
 * already covers it. Null when the value is not a server address at all.
 */
export function requiredConnectOrigins(serverUrl: string): string[] | null {
  // A relative value (`VITE_MANIFESTO_SERVER=/`, or the empty string it trims
  // to) asks for no origin the policy has to name: it resolves against this
  // page, which `'self'` already permits. That is the single-proxy shape.
  if (serverUrl === "" || serverUrl.startsWith("/")) return [];
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const wsScheme = url.protocol === "https:" ? "wss:" : "ws:";
  return [`${url.protocol}//${url.host}`, `${wsScheme}//${url.host}`];
}

/** The `connect-src` sources, falling back to `default-src`, or null. */
function connectSources(policy: string): string[] | null {
  let fallback: string[] | null = null;
  for (const directive of policy.split(";")) {
    const parts = directive.trim().split(/\s+/).filter(Boolean);
    const name = parts[0]?.toLowerCase();
    if (name === "connect-src") return parts.slice(1);
    if (name === "default-src") fallback = parts.slice(1);
  }
  return fallback;
}

/**
 * `'self'` matches the page's own origin, and CSP3 extends it to the `ws(s)`
 * form of the same host, which is what lets a single-origin deployment keep
 * the stock `connect-src 'self'` untouched.
 */
function coveredBySelf(origin: string, pageOrigin: string): boolean {
  if (origin === pageOrigin) return true;
  const page = splitOrigin(pageOrigin);
  const target = splitOrigin(origin);
  if (!page || !target || page.host !== target.host) return false;
  return (
    (page.scheme === "https:" && target.scheme === "wss:") ||
    (page.scheme === "http:" && target.scheme === "ws:")
  );
}

/** `https://*.example.com` against `https://notes.example.com`. */
function coveredByWildcard(source: string, origin: string): boolean {
  const star = source.indexOf("://*.");
  if (star === -1) return false;
  const scheme = source.slice(0, star + 3);
  const suffix = source.slice(star + 4);
  return (
    origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(suffix)
  );
}

function permits(
  sources: string[],
  origin: string,
  pageOrigin: string,
): boolean {
  return sources.some((source) => {
    if (source === origin) return true;
    if (source === "'self'") return coveredBySelf(origin, pageOrigin);
    // A scheme-only source (`https:`) permits every origin on that scheme.
    if (source.endsWith(":") && !source.includes("/")) {
      return origin.startsWith(source);
    }
    return coveredByWildcard(source, origin);
  });
}

/**
 * Which of `required` the policy does not permit. Empty when the policy is
 * fine, and empty when there is nothing to judge it by.
 */
export function missingConnectSources(
  policy: string | null,
  required: string[],
  pageOrigin: string,
): string[] {
  if (policy === null || required.length === 0) return [];
  const sources = connectSources(policy);
  if (sources === null || sources.includes("*")) return [];
  return required.filter((origin) => !permits(sources, origin, pageOrigin));
}

/** The thing stopping this page from reaching its server, or null. */
export function findServerSetupProblem(
  serverUrl: string | null,
  policy: string | null,
  pageOrigin: string,
): ServerSetupProblem | null {
  if (serverUrl === null) return null;
  const required = requiredConnectOrigins(serverUrl);
  if (required === null) return { kind: "invalid-url", serverUrl };
  const missing = missingConnectSources(policy, required, pageOrigin);
  return missing.length > 0
    ? { kind: "csp-blocked", serverUrl, missing }
    : null;
}

/** The same question, asked of the document this page was served as. */
export function serverSetupProblem(
  serverUrl: string | null,
): ServerSetupProblem | null {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }
  const policy =
    document.querySelector<HTMLMetaElement>(
      'meta[http-equiv="Content-Security-Policy" i]',
    )?.content ?? null;
  return findServerSetupProblem(serverUrl, policy, window.location.origin);
}
