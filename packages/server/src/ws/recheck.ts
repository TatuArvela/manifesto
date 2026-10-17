import { type ApiTokenScope, hasScope } from "@manifesto/shared";
import type { AuthProvider } from "#/auth/types.js";
import { logger } from "#/lib/logger.js";

/**
 * How often an open socket's credential is looked at again.
 *
 * A socket is authenticated once, at connect. Ending a session by hand
 * reaches it through `auth/revocations.ts`, but one that simply runs out (a
 * session past its absolute lifetime, an API token past its expiry) announces
 * nothing, and its sockets would go on carrying notes for as long as they
 * stayed connected. Looking again is also a use of the session, as a request
 * is, so a tab left open and connected does not slide into expiry.
 */
export const SOCKET_RECHECK_MS = 5 * 60 * 1000;

/**
 * Whether `token` still opens a socket that asks for `scope`. A check that
 * could not be made (the database away for a moment) counts as yes: the next
 * pass asks again, and dropping every socket at once would not be safer.
 */
export async function stillOpens(
  authProvider: AuthProvider,
  token: string,
  scope: ApiTokenScope,
): Promise<boolean> {
  try {
    const identity = await authProvider.authenticate(token);
    return (
      identity !== null &&
      identity.via !== "mcp-token" &&
      (!identity.scopes || hasScope(identity.scopes, scope))
    );
  } catch (err) {
    logger.warn("A socket's credential could not be rechecked", {
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * One pass: asks once per distinct token and calls `close` for each holder
 * of one that no longer opens the socket.
 */
export async function recheckSockets<T>(
  authProvider: AuthProvider,
  scope: ApiTokenScope,
  holders: Iterable<{ token: string; socket: T }>,
  close: (socket: T) => void,
): Promise<void> {
  const byToken = new Map<string, T[]>();
  for (const { token, socket } of holders) {
    const held = byToken.get(token);
    if (held) held.push(socket);
    else byToken.set(token, [socket]);
  }
  for (const [token, sockets] of byToken) {
    if (await stillOpens(authProvider, token, scope)) continue;
    for (const socket of sockets) close(socket);
  }
}
