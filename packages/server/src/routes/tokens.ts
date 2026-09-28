import { zValidator } from "@hono/zod-validator";
import {
  API_TOKEN_SCOPES,
  type ApiTokenCreatedResponse,
  type ApiTokensResponse,
  DEFAULT_API_TOKEN_SCOPES,
} from "@manifesto/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { audit } from "../audit/audit.js";
import { requireConfirmation } from "../auth/confirmation.js";
import type { LoginAttempts } from "../auth/local/loginAttempts.js";
import type { SessionRevocations } from "../auth/revocations.js";
import { revokeApiToken } from "../auth/session.js";
import type { AuthProvider } from "../auth/types.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { hashToken, MCP_TOKEN_PREFIX, newApiToken } from "../lib/token.js";
import { newId } from "../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { apiTokenCreateSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

interface TokenDeps {
  storage: StorageDriver;
  loginAttempts: LoginAttempts;
  /** Whether the server has `/api/mcp`; without it an MCP token opens nothing. */
  mcpEnabled: boolean;
  authProvider: AuthProvider;
  revocations: SessionRevocations;
  rateLimit?: MiddlewareHandler;
}

/** Enough for any honest set of scripts, and a bound on a runaway one. */
export const MAX_API_TOKENS_PER_USER = 50;

/** Characters of the secret kept to tell tokens apart: the prefix and six. */
const SHOWN_PREFIX_LENGTH = 10;

/**
 * `/api/tokens`: a user's personal API tokens, for scripts, shortcuts and
 * bots that should not hold a password. Managed with a session only, so a
 * token cannot mint more of itself or outlive its own revocation.
 */
export function createTokenRoutes(deps: TokenDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
  routes.use(
    "*",
    createAuthMiddleware(deps.authProvider, { sessionOnly: true }),
  );
  if (deps.rateLimit) routes.use("*", deps.rateLimit);

  routes.get("/", async (c) => {
    const { userId } = c.get("auth");
    const body: ApiTokensResponse = {
      tokens: await deps.storage.apiTokens.listByUser(userId),
    };
    return c.json(body);
  });

  routes.post(
    "/",
    zValidator("json", apiTokenCreateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const {
        name,
        expiresInDays,
        kind = "api",
        scopes,
        password,
      } = c.req.valid("json");
      // A token outlives the session that minted it.
      await requireConfirmation(deps, c.get("auth"), password);
      if (kind === "mcp" && !deps.mcpEnabled) {
        throw new HttpError(403, "This server has MCP turned off");
      }
      const existing = await deps.storage.apiTokens.listByUser(userId);
      if (existing.length >= MAX_API_TOKENS_PER_USER) {
        throw new HttpError(409, "Revoke a token before creating another");
      }
      const secret = newApiToken(kind === "mcp" ? MCP_TOKEN_PREFIX : undefined);
      const now = nowIso();
      // In the one order the list uses, each once.
      const granted = API_TOKEN_SCOPES.filter((scope) =>
        (scopes ?? DEFAULT_API_TOKEN_SCOPES).includes(scope),
      );
      const token = {
        id: newId(),
        name,
        kind,
        scopes: granted,
        prefix: secret.slice(0, SHOWN_PREFIX_LENGTH),
        createdAt: now,
        lastUsedAt: null,
        expiresAt:
          expiresInDays === undefined ? null : isoPlusDays(expiresInDays),
      };
      await deps.storage.apiTokens.create({
        ...token,
        userId,
        tokenHash: hashToken(secret),
      });
      audit(deps.storage, c, {
        action: "token.created",
        actorId: userId,
        detail: {
          name,
          prefix: token.prefix,
          kind,
          scopes: granted.join(" "),
        },
      });
      const body: ApiTokenCreatedResponse = { token, secret };
      return c.json(body, 201);
    },
  );

  routes.delete("/:id", async (c) => {
    const { userId } = c.get("auth");
    const revoked = await revokeApiToken(
      deps.storage,
      deps.revocations,
      userId,
      c.req.param("id"),
    );
    if (!revoked) throw new HttpError(404, "Token not found");
    audit(deps.storage, c, {
      action: "token.revoked",
      actorId: userId,
      detail: { id: c.req.param("id") },
    });
    return c.body(null, 204);
  });

  return routes;
}
