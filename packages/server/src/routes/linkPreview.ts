import { zValidator } from "@hono/zod-validator";
import type { LinkPreviewResponse } from "@manifesto/shared";
import { Hono } from "hono";
import type { LinkPreviewFetcher } from "#/linkPreview/fetchPreview.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { linkPreviewQuerySchema } from "#/validation/noteSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";

interface LinkPreviewDeps {
  fetchPreview: LinkPreviewFetcher;
}

/**
 * `/api/link-preview`. With `LINK_PREVIEWS=off` the protection answers 404
 * before this is reached, so the server never fetches anything.
 */
export function createLinkPreviewRoutes(deps: LinkPreviewDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
  routes.get(
    "/",
    zValidator("query", linkPreviewQuerySchema, validatorHook),
    async (c) => {
      const { url } = c.req.valid("query");
      const body: LinkPreviewResponse = {
        preview: await deps.fetchPreview(url),
      };
      return c.json(body);
    },
  );

  return routes;
}
