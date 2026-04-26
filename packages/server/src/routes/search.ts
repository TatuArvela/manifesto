import { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import type { NotesRepo } from "../db/repositories/notes.js";
import type { SessionsRepo } from "../db/repositories/sessions.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";

interface SearchDeps {
  notesRepo: NotesRepo;
  sessionsRepo: SessionsRepo;
  cfg: ServerConfig;
}

export function createSearchRoutes(deps: SearchDeps) {
  const search = new Hono<{ Variables: { auth: AuthContext } }>();
  search.use("*", createAuthMiddleware(deps.sessionsRepo, deps.cfg));

  search.get("/", async (c) => {
    const { userId } = c.get("auth");
    const q = c.req.query("q") ?? "";
    if (q.trim().length === 0) {
      return c.json({ notes: [] });
    }
    const results = await deps.notesRepo.search(userId, q);
    return c.json({ notes: results });
  });

  return search;
}
