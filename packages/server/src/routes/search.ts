import { Hono } from "hono";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";

/**
 * `/api/search`. The server cannot read a note, so it cannot search one: the
 * app searches the notes it has opened, in memory. What is left here is for
 * a token that carries a key.
 */
export function createSearchRoutes() {
  const search = new Hono<{ Variables: { auth: AuthContext } }>();

  search.get("/", () => {
    throw new HttpError(403, "The app searches its own notes");
  });

  return search;
}
