import type { Context } from "hono";

/**
 * The own address of this server, as the client reached it. Behind a proxy with
 * `TRUST_PROXY` on, it is the scheme and host at which the client reached the
 * proxy. An address built from the side of the socket (`http://10.0.0.5:3001`)
 * is not an address that a person outside used. This is important when it names
 * an OAuth issuer, or the origin against which a passkey is checked.
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
