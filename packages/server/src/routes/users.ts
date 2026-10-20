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

/**
 * The number of accounts that a search shows. Sufficient to select from while
 * you type.
 */
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
 * `GET /api/v1/users?q=`: the accounts with which a note could be shared.
 *
 * With `USER_LOOKUP=search`, any part of a username, display name or email
 * address matches. With `exact`, only a full username or address matches, and
 * the answer never contains an address. A person who knew only the username
 * learns nothing more about the account than that it exists. The results never
 * include the signed-in user.
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
   * The public keys of an account, to wrap a note key to, and to check what it
   * signed. They are public by nature. Thus, all signed-in accounts can ask for
   * them, by id. `404` for an account that is not set up yet, which then has
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
