import { Hono } from "hono";
import type { AuthProvider } from "../auth/types.js";
import type { ServerConfig } from "../config.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import type { StorageDriver } from "../storage/types.js";

interface SearchDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  cfg: ServerConfig;
}

export function createSearchRoutes(deps: SearchDeps) {
  const search = new Hono<{ Variables: { auth: AuthContext } }>();
  search.use("*", createAuthMiddleware(deps.authProvider));

  search.get("/", async (c) => {
    const { userId } = c.get("auth");
    const q = c.req.query("q") ?? "";
    if (q.trim().length === 0) {
      return c.json({ notes: [] });
    }
    const results = await deps.storage.notes.search(userId, q);
    return c.json({ notes: results });
  });

  return search;
}
