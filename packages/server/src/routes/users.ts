import type { DirectoryUser, UserLookupResponse } from "@manifesto/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AuthProvider } from "../auth/types.js";
import type { ServerConfig } from "../config.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import type { StorageDriver, User } from "../storage/types.js";

interface UsersDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  rateLimit?: MiddlewareHandler;
}

/** How many accounts a search offers. Enough to pick from while typing. */
const SEARCH_LIMIT = 10;

function toDirectoryUser(user: User, withEmail: boolean): DirectoryUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    avatarColor: user.avatarColor,
    ...(withEmail && user.email !== null && { email: user.email }),
  };
}

/**
 * `GET /api/users?q=`: the accounts a note could be shared with.
 *
 * Under `USER_LOOKUP=search` any part of a username, display name or email
 * address matches. Under `exact` only a whole username or address does, and
 * the answer never carries an address: someone who knew only the username
 * learns nothing more about the account than that it exists. The signed-in
 * user is never among the results.
 */
export function createUsersRoutes(deps: UsersDeps) {
  const users = new Hono<{ Variables: { auth: AuthContext } }>();
  users.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) users.use("*", deps.rateLimit);

  users.get("/", async (c) => {
    const { userId } = c.get("auth");
    const q = (c.req.query("q") ?? "").trim();
    if (q.length === 0 || q.length > 254) {
      const body: UserLookupResponse = { users: [] };
      return c.json(body);
    }

    if (deps.cfg.userLookup === "search") {
      const found = await deps.storage.users.search(q, {
        excludeId: userId,
        limit: SEARCH_LIMIT,
      });
      const body: UserLookupResponse = {
        users: found.map((user) => toDirectoryUser(user, true)),
      };
      return c.json(body);
    }

    const byName = await deps.storage.users.findByUsername(q);
    const byEmail = q.includes("@")
      ? await deps.storage.users.findByEmail(q)
      : null;
    const found = [byName, byEmail].filter(
      (user, i, all): user is User =>
        user !== null &&
        user.id !== userId &&
        all.findIndex((other) => other?.id === user.id) === i,
    );
    const body: UserLookupResponse = {
      users: found.map((user) => toDirectoryUser(user, false)),
    };
    return c.json(body);
  });

  return users;
}
