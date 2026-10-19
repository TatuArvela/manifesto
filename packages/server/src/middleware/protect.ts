import type { Context, MiddlewareHandler } from "hono";
import type { AuthProvider } from "#/auth/types.ts";
import type { ServerConfig } from "#/config.ts";
import { isFeatureOn } from "#/features.ts";
import { OPERATIONS, type Operation } from "#/openapi.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { type AuthContext, createAuthMiddleware } from "./authBearer.ts";
import { HttpError } from "./error.ts";
import { perUserApiRateLimit, rateLimit } from "./rateLimit.ts";

/**
 * The rate-limit buckets that an operation can use. An `address` bucket counts
 * the address of the caller, and runs before authentication. Thus, it limits
 * what an anonymous caller can make the server do (a password verification, a
 * challenge). A `user` bucket counts the account, and runs after. Operations
 * that name the same bucket share it. Thus, a move between them gives nothing.
 */
export const BUCKETS = {
  /** Usual use of the API, shared by all data routes. */
  user: { per: "user", limit: 300, windowMs: 60 * 1000 },
  /** A grid asks for one image for each card, each one time in each session. */
  attachments: { per: "user", limit: 1200, windowMs: 60 * 1000 },
  /**
   * Each one makes the server get a page and up to two images from a different
   * place. A paste of a block of links is the heaviest usual use, and a note
   * has a maximum of twenty. In addition to `user`.
   */
  "link-preview": { per: "user", limit: 40, windowMs: 60 * 1000 },
  /**
   * All routes that verify a password or a code: sign-in, registration, the
   * password and two-factor changes, reset by mail. It is strict, against
   * password spraying. The budget for each name in
   * `auth/local/loginAttempts.ts` is the part that a caller who moves between
   * addresses cannot avoid.
   */
  "sign-in": { per: "address", limit: 10, windowMs: 15 * 60 * 1000 },
  /** Nobody can guess a passkey. This limits the number of challenges. */
  "passkey-sign-in": { per: "address", limit: 60, windowMs: 15 * 60 * 1000 },
  /**
   * `/login` makes a pending flow, and `/callback` uses discovery and a token
   * exchange. Without this, an anonymous caller controls the memory and the
   * outbound requests of the process. It is less strict than `sign-in`. There
   * is no password to spray, a sign-in uses two requests, and users of single
   * sign-on frequently share an egress address.
   */
  oidc: { per: "address", limit: 30, windowMs: 15 * 60 * 1000 },
  /** Calendar apps poll, some each few minutes. */
  calendar: { per: "address", limit: 60, windowMs: 60 * 1000 },
  "public-links": { per: "address", limit: 120, windowMs: 60 * 1000 },
  /** Passwords on public links, in addition to `public-links`. */
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
 * Routes that check their own caller, because what they get is not a request
 * with a header. `/api/v1/ws` reads its token from the WebSocket subprotocol,
 * and checks its scope in its own code (`ws/appSocket.ts`). `/api/v1/yjs` is
 * upgraded outside the app, and never reaches this.
 */
const SELF_AUTHENTICATED = new Set(["GET /api/v1/ws"]);

/**
 * The protection of each `/api/v1/*` request, from what `OPERATIONS` declares
 * for the route that will answer it: first its address buckets, then who can
 * call it (nobody special, any credential, a session, an MCP token, the session
 * of an admin), then its account buckets. Routers mount none of this
 * themselves. Thus, the protection of a route is in one place, next to its
 * description.
 *
 * The middleware refuses a route that matched but is not declared, whatever it
 * is. Thus, if you forget to declare a route, it closes. It does not open.
 * `openapi.test.ts` fails on it before it ships.
 *
 * Before all of that, an operation of a feature that the host turned off
 * answers the own 404 of the app for a route that does not exist. Thus, nobody,
 * signed in or not, can tell a feature that is off from a feature that this
 * server never had.
 */
export function createProtection(deps: {
  authProvider: AuthProvider;
  storage: StorageDriver;
  cfg: ServerConfig;
}): MiddlewareHandler<{ Variables: { auth: AuthContext } }> {
  const limiters = Object.fromEntries(
    Object.entries(BUCKETS).map(([name, bucket]) => [
      name,
      bucket.per === "user"
        ? perUserApiRateLimit(bucket.limit, name)
        : rateLimit({
            limit: bucket.limit,
            windowMs: bucket.windowMs,
            trustProxy: deps.cfg.trustProxy,
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
    // Built on the first use. `openapi.ts` reaches the validation schemas, and
    // nothing here must depend on the load order.
    byRoute ??= new Map(
      OPERATIONS.map((op) => [`${op.method.toUpperCase()} ${op.path}`, op]),
    );
    // The route that will answer: not middleware (`ALL`), and not the catch-all
    // of the client, which is not an API route.
    const route = c.req.matchedRoutes.findLast(
      (r) => r.method !== "ALL" && r.path.startsWith("/api/v1/"),
    );
    if (!route) return null;
    const key = `${route.method} ${route.path}`;
    if (SELF_AUTHENTICATED.has(key)) return null;
    return byRoute.get(key);
  }

  return async (c, next) => {
    const op = operationFor(c);
    // Nothing here will answer (a 404), or the route checks itself.
    if (op === null) return next();
    if (op === undefined) {
      throw new HttpError(403, "This route declares no protection");
    }
    if (op.feature && !isFeatureOn(deps.cfg, op.feature)) return c.notFound();
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
