import type { Context, MiddlewareHandler } from "hono";
import type { AuthProvider } from "../auth/types.js";
import { OPERATIONS, type Operation } from "../openapi.js";
import type { StorageDriver } from "../storage/types.js";
import { type AuthContext, createAuthMiddleware } from "./authBearer.js";
import { HttpError } from "./error.js";
import { perUserApiRateLimit, rateLimit } from "./rateLimit.js";

/**
 * The rate-limit buckets an operation can draw from. An `address` bucket
 * counts the caller's address and runs before authentication, so it bounds
 * what an anonymous caller can make the server do (a password verify, a
 * challenge); a `user` bucket counts the account and runs after. Operations
 * that name the same bucket share it, so moving between them gains nothing.
 */
export const BUCKETS = {
  /** Everyday use of the API, shared by every data route. */
  user: { per: "user", limit: 300, windowMs: 60 * 1000 },
  /** A grid asks for an image per card, each once per session. */
  attachments: { per: "user", limit: 1200, windowMs: 60 * 1000 },
  /** Each makes the server fetch a page and up to two images from somewhere
   * else. Pasting a block of links is the heaviest ordinary use, and a note
   * holds at most twenty. On top of `user`. */
  "link-preview": { per: "user", limit: 40, windowMs: 60 * 1000 },
  /** Everything that verifies a password or a code: sign-in, registration,
   * the password and the two-factor changes, reset by mail. Tight, against
   * password spraying; the per-name budget in `auth/local/loginAttempts.ts`
   * is the part a caller moving between addresses cannot escape. */
  "sign-in": { per: "address", limit: 10, windowMs: 15 * 60 * 1000 },
  /** A passkey cannot be guessed at; this bounds the challenges issued. */
  "passkey-sign-in": { per: "address", limit: 60, windowMs: 15 * 60 * 1000 },
  /** `/login` mints a pending flow and `/callback` spends discovery and a
   * token exchange, so without this an anonymous caller sets the memory and
   * outbound-request cost of the process. Looser than `sign-in`: there is no
   * password to spray, a sign-in costs two requests, and single sign-on users
   * routinely share an egress address. */
  oidc: { per: "address", limit: 30, windowMs: 15 * 60 * 1000 },
  /** Calendar apps poll, some every few minutes. */
  calendar: { per: "address", limit: 60, windowMs: 60 * 1000 },
  "public-links": { per: "address", limit: 120, windowMs: 60 * 1000 },
  /** Passwords on public links, on top of `public-links`. */
  "public-link-unlock": {
    per: "address",
    limit: 10,
    windowMs: 15 * 60 * 1000,
  },
  "oauth-register": { per: "address", limit: 20, windowMs: 60 * 60 * 1000 },
  "oauth-token": { per: "address", limit: 60, windowMs: 60 * 1000 },
} as const satisfies Record<
  string,
  { per: "address" | "user"; limit: number; windowMs: number }
>;

export type Bucket = keyof typeof BUCKETS;

const noop = async () => {};

/**
 * Routes that check their own caller, because what they take is not a
 * request with a header: `/api/ws` reads its token from the WebSocket
 * subprotocol and its scope by hand (`ws/appSocket.ts`). `/api/yjs` is
 * upgraded outside the app and never reaches this.
 */
const SELF_AUTHENTICATED = new Set(["GET /api/ws"]);

/**
 * Every `/api/*` request's protection, from what `OPERATIONS` declares for
 * the route that will answer it: its address buckets, then who may call it
 * (nobody in particular, any credential, a session, an MCP token, an admin's
 * session), then its account buckets. Routers mount none of this themselves,
 * so a route's protection is read in one place, next to its description.
 *
 * A route that matched but is not declared is refused, whatever it is:
 * forgetting to declare one closes it rather than opening it.
 * `openapi.test.ts` fails on it before it ships.
 */
export function createProtection(deps: {
  authProvider: AuthProvider;
  storage: StorageDriver;
  trustProxy: boolean;
}): MiddlewareHandler<{ Variables: { auth: AuthContext } }> {
  const limiters = Object.fromEntries(
    Object.entries(BUCKETS).map(([name, bucket]) => [
      name,
      bucket.per === "user"
        ? perUserApiRateLimit(bucket.limit, name)
        : rateLimit({
            limit: bucket.limit,
            windowMs: bucket.windowMs,
            trustProxy: deps.trustProxy,
            name,
          }),
    ]),
  ) as Record<Bucket, MiddlewareHandler>;

  const authenticate = {
    any: createAuthMiddleware(deps.authProvider),
    session: createAuthMiddleware(deps.authProvider, { sessionOnly: true }),
    mcp: createAuthMiddleware(deps.authProvider, { mcpOnly: true }),
  };

  let byRoute: Map<string, Operation> | undefined;

  function operationFor(c: Context): Operation | null | undefined {
    // Built on first use: `openapi.ts` reaches the validation schemas, and
    // nothing here should depend on load order.
    byRoute ??= new Map(
      OPERATIONS.map((op) => [`${op.method.toUpperCase()} ${op.path}`, op]),
    );
    // The route that will answer: not middleware (`ALL`), and not the
    // client's catch-all, which is no API route.
    const route = c.req.matchedRoutes.findLast(
      (r) => r.method !== "ALL" && r.path.startsWith("/api/"),
    );
    if (!route) return null;
    const key = `${route.method} ${route.path}`;
    if (SELF_AUTHENTICATED.has(key)) return null;
    return byRoute.get(key);
  }

  return async (c, next) => {
    const op = operationFor(c);
    // Nothing here will answer (a 404), or the route checks for itself.
    if (op === null) return next();
    if (op === undefined) {
      throw new HttpError(403, "This route declares no protection");
    }
    for (const bucket of op.limits) {
      if (BUCKETS[bucket].per === "address") await limiters[bucket](c, noop);
    }
    if (op.auth !== "none") {
      await authenticate[op.auth === "admin" ? "session" : op.auth](c, noop);
    }
    if (op.auth === "admin") {
      const caller = await deps.storage.users.findById(c.get("auth").userId);
      if (!caller?.isAdmin) throw new HttpError(403, "Admin access required");
    }
    for (const bucket of op.limits) {
      if (BUCKETS[bucket].per === "user") await limiters[bucket](c, noop);
    }
    await next();
  };
}
