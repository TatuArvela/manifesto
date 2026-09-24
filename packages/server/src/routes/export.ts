import { Hono, type MiddlewareHandler } from "hono";
import { audit } from "../audit/audit.js";
import type { AuthProvider } from "../auth/types.js";
import { exportAccount, sendExport } from "../export/userExport.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";

interface ExportDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  rateLimit?: MiddlewareHandler;
}

/**
 * `/api/export`: the account's own notes, all of them, as a zip. Any
 * credential will do, an API token included, so a backup can be scripted.
 */
export function createExportRoutes(deps: ExportDeps) {
  const exportRoute = new Hono<{ Variables: { auth: AuthContext } }>();
  exportRoute.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) exportRoute.use("*", deps.rateLimit);
  exportRoute.get("/", async (c) => {
    const { userId } = c.get("auth");
    const zip = await exportAccount(deps.storage, userId);
    if (!zip) throw new HttpError(401, "User not found");
    audit(deps.storage, c, { action: "account.exported", actorId: userId });
    const user = await deps.storage.users.findById(userId);
    return sendExport(c, zip, user?.username);
  });
  return exportRoute;
}
