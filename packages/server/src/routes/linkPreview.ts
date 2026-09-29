import { zValidator } from "@hono/zod-validator";
import type { LinkPreviewResponse } from "@manifesto/shared";
import { Hono } from "hono";
import type { LinkPreviewFetcher } from "../linkPreview/fetchPreview.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import { linkPreviewQuerySchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

interface LinkPreviewDeps {
  /** Null when the operator has turned previews off (`LINK_PREVIEWS=off`). */
  fetchPreview: LinkPreviewFetcher | null;
}

export function createLinkPreviewRoutes(deps: LinkPreviewDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
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
