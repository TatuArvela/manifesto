import type { Context } from "hono";

/**
 * This server's own address as the client reached it. Behind a proxy with
 * `TRUST_PROXY` on, the scheme and host the proxy was reached at: one built
 * from the socket's side (`http://10.0.0.5:3001`) is not an address anyone
 * outside used, whether it names an OAuth issuer or the origin a passkey is
 * checked against.
 */
export function publicOrigin(c: Context, trustProxy: boolean): string {
  const url = new URL(c.req.url);
  if (trustProxy) {
    const proto = c.req.header("X-Forwarded-Proto")?.split(",")[0]?.trim();
    const host = c.req.header("X-Forwarded-Host")?.split(",")[0]?.trim();
    if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
    if (host) url.host = host;
  }
  return url.origin;
}
