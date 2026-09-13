import { zValidator } from "@hono/zod-validator";
import type { LinkPreviewResponse } from "@manifesto/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AuthProvider } from "../auth/types.js";
import type { LinkPreviewFetcher } from "../linkPreview/fetchPreview.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { linkPreviewQuerySchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

interface LinkPreviewDeps {
  authProvider: AuthProvider;
  /** Null when the operator has turned previews off (`LINK_PREVIEWS=off`). */
  fetchPreview: LinkPreviewFetcher | null;
  rateLimit?: MiddlewareHandler;
}

/**
 * Every request here makes the server fetch a page and up to two images from
 * somewhere else, so it gets a budget of its own on top of the shared API one.
 * Pasting a block of links is the heaviest ordinary use, and a note holds at
 * most twenty.
 */
const PREVIEWS_PER_MINUTE = 40;

export function createLinkPreviewRoutes(deps: LinkPreviewDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
  routes.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) routes.use("*", deps.rateLimit);
  routes.use(
    "*",
    rateLimit({
      limit: PREVIEWS_PER_MINUTE,
      windowMs: 60 * 1000,
      keyFor: (c) => `user:${c.get("auth").userId}`,
    }),
  );

  routes.get(
    "/",
    zValidator("query", linkPreviewQuerySchema, validatorHook),
    async (c) => {
      if (!deps.fetchPreview) {
        throw new HttpError(404, "Link previews are disabled on this server");
      }
      const { url } = c.req.valid("query");
      const body: LinkPreviewResponse = {
        preview: await deps.fetchPreview(url),
      };
      return c.json(body);
    },
  );

  return routes;
}
