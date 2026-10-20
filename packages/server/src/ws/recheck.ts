import { type ApiTokenScope, hasScope } from "@manifesto/shared";
import type { AuthProvider } from "#/auth/types.ts";
import { logger } from "#/lib/logger.ts";

/**
 * How frequently the server checks the credential of an open socket again.
 *
 * A socket authenticates one time, at connect. A manual end of a session
 * reaches it through `auth/revocations.ts`. But a session or token that only
 * expires (a session past its absolute lifetime, an API token past its expiry)
 * announces nothing. Its sockets would continue to carry notes while they stay
 * connected. A check is also a use of the session, as a request is. Thus, a tab
 * that stays open and connected does not slide into expiry.
 */
export const SOCKET_RECHECK_MS = 5 * 60 * 1000;

/**
 * If `token` still opens a socket that asks for `scope`. If the code could not
 * do the check (the database was not available for a moment), the answer is
 * yes. The next pass asks again, and to drop all sockets at the same time would
 * not be safer.
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
 * One pass. It asks one time for each different token, and calls `close` for
 * each holder of a token that does not open the socket now.
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
