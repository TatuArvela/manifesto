import type {
  AccountPublicKeysResponse,
  DirectoryUser,
  UserLookupResponse,
} from "@manifesto/shared";
import { Hono } from "hono";
import type { ServerConfig } from "#/config.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver, User } from "#/storage/types.ts";

interface UsersDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
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
 * `GET /api/v1/users?q=`: the accounts a note could be shared with.
 *
 * Under `USER_LOOKUP=search` any part of a username, display name or email
 * address matches. Under `exact` only a whole username or address does, and
 * the answer never carries an address: someone who knew only the username
 * learns nothing more about the account than that it exists. The signed-in
 * user is never among the results.
 */
export function createUsersRoutes(deps: UsersDeps) {
  const users = new Hono<{ Variables: { auth: AuthContext } }>();

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

  /**
   * An account's public keys, for wrapping a note key to and for checking
   * what it signed. Public by nature, so any signed-in account may ask, by
   * id. `404` for an account that has not been set up yet, which then has
   * nothing to wrap to.
   */
  users.get("/:id/keys", async (c) => {
    const id = c.req.param("id");
    const keys = await deps.storage.accountKeys.get(id);
    if (!keys) throw new HttpError(404, "This account has no keys yet");
    const body: AccountPublicKeysResponse = {
      userId: id,
      version: keys.version,
      publicKeys: {
        exchange: keys.exchangePublicKey,
        signing: keys.signingPublicKey,
      },
    };
    return c.json(body);
  });

  return users;
}
