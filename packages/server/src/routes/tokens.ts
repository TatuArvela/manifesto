import { zValidator } from "@hono/zod-validator";
import {
  API_TOKEN_SCOPES,
  type ApiTokenCreatedResponse,
  type ApiTokensResponse,
  DEFAULT_API_TOKEN_SCOPES,
} from "@manifesto/shared";
import { Hono } from "hono";
import { audit } from "#/audit/audit.js";
import { requireConfirmation } from "#/auth/confirmation.js";
import type { LoginAttempts } from "#/auth/local/loginAttempts.js";
import type { SessionRevocations } from "#/auth/revocations.js";
import { revokeApiToken } from "#/auth/session.js";
import type { ServerConfig } from "#/config.js";
import { isFeatureOn, TOKEN_FEATURES } from "#/features.js";
import { isoPlusDays, nowIso } from "#/lib/time.js";
import {
  API_TOKEN_PREFIX,
  CALENDAR_TOKEN_PREFIX,
  hashToken,
  MAX_API_TOKENS_PER_USER,
  MCP_TOKEN_PREFIX,
  newApiToken,
  SHOWN_PREFIX_LENGTH,
} from "#/lib/token.js";
import { newId } from "#/lib/ulid.js";
import type { AuthContext } from "#/middleware/authBearer.js";
import { HttpError } from "#/middleware/error.js";
import type { StorageDriver } from "#/storage/types.js";
import { apiTokenCreateSchema } from "#/validation/schemas.js";
import { validatorHook } from "#/validation/zValidator.js";

interface TokenDeps {
  storage: StorageDriver;
  loginAttempts: LoginAttempts;
  /** Which kinds of token the server's features allow (`TOKEN_FEATURES`). */
  cfg: ServerConfig;
  revocations: SessionRevocations;
}

/**
 * `/api/tokens`: a user's personal API tokens, for scripts, shortcuts and
 * bots that should not hold a password. Managed with a session only, so a
 * token cannot mint more of itself or outlive its own revocation.
 *
 * The page belongs to no one feature: it holds three kinds of token, each
 * minted only while its own feature is on, and listing and revoking stay
 * open whatever is off, so a token can always be taken back.
 */
export function createTokenRoutes(deps: TokenDeps) {
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();

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
        tokenHash,
        prefix,
        wrappedKeys,
      } = c.req.valid("json");
      if (!isFeatureOn(deps.cfg, TOKEN_FEATURES[kind])) {
        throw new HttpError(403, "This server has that kind of token off");
      }
      // A token outlives the session that minted it.
      await requireConfirmation(deps, c.get("auth"), password);
      const existing = await deps.storage.apiTokens.listByUser(userId);
      if (existing.length >= MAX_API_TOKENS_PER_USER) {
        throw new HttpError(409, "Revoke a token before creating another");
      }
      const kindPrefix =
        kind === "mcp"
          ? MCP_TOKEN_PREFIX
          : kind === "calendar"
            ? CALENDAR_TOKEN_PREFIX
            : API_TOKEN_PREFIX;
      // A token that reaches notes carries their keys, so the app makes it
      // and the server is told its hash, never the secret. The secret has to
      // be one of this kind's, or the token would be looked for among the
      // wrong ones when it is presented.
      if (tokenHash !== undefined && !prefix?.startsWith(kindPrefix)) {
        throw new HttpError(422, "prefix: Not a token of this kind");
      }
      if (
        tokenHash !== undefined &&
        (await deps.storage.apiTokens.findByHash(tokenHash))
      ) {
        throw new HttpError(409, "A token already has this secret");
      }
      const secret = tokenHash === undefined ? newApiToken(kindPrefix) : null;
      const now = nowIso();
      // In the one order the list uses, each once. A calendar token reaches
      // one feed, which no scope names.
      const granted =
        kind === "calendar"
          ? []
          : API_TOKEN_SCOPES.filter((scope) =>
              (scopes ?? DEFAULT_API_TOKEN_SCOPES).includes(scope),
            );
      const token = {
        id: newId(),
        name,
        kind,
        scopes: granted,
        prefix: secret?.slice(0, SHOWN_PREFIX_LENGTH) ?? prefix ?? "",
        createdAt: now,
        lastUsedAt: null,
        expiresAt:
          expiresInDays === undefined ? null : isoPlusDays(expiresInDays),
      };
      await deps.storage.apiTokens.create({
        ...token,
        userId,
        tokenHash: secret ? hashToken(secret) : (tokenHash ?? ""),
        accessExpiresAt: null,
        wrappedKeys: wrappedKeys ?? null,
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
      const body: ApiTokenCreatedResponse = {
        token,
        ...(secret !== null && { secret }),
      };
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
