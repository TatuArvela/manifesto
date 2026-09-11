import { Hono, type MiddlewareHandler } from "hono";
import type { AuthProvider } from "../auth/types.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import type { StorageDriver } from "../storage/types.js";
import { readPageParams } from "../validation/pageParams.js";

interface SearchDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  rateLimit?: MiddlewareHandler;
}

export function createSearchRoutes(deps: SearchDeps) {
  const search = new Hono<{ Variables: { auth: AuthContext } }>();
  search.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) search.use("*", deps.rateLimit);

  search.get("/", async (c) => {
    const { userId } = c.get("auth");
    const q = c.req.query("q") ?? "";
    if (q.trim().length === 0) {
      return c.json({ notes: [], nextCursor: null });
    }
    const page = readPageParams(c.req.query("limit"), c.req.query("cursor"));
    return c.json(await deps.storage.notes.search(userId, q, page));
  });

  return search;
}
