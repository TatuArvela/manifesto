import { zValidator } from "@hono/zod-validator";
import {
  API_TOKEN_SCOPES,
  type ApiTokenCreatedResponse,
  type ApiTokensResponse,
  DEFAULT_API_TOKEN_SCOPES,
} from "@manifesto/shared";
import { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { requireConfirmation } from "#/auth/confirmation.ts";
import type { LoginAttempts } from "#/auth/local/loginAttempts.ts";
import type { SessionRevocations } from "#/auth/revocations.ts";
import { revokeApiToken } from "#/auth/session.ts";
import type { ServerConfig } from "#/config.ts";
import { isFeatureOn, TOKEN_FEATURES } from "#/features.ts";
import { isoPlusDays, nowIso } from "#/lib/time.ts";
import {
  API_TOKEN_PREFIX,
  CALENDAR_TOKEN_PREFIX,
  hashToken,
  MAX_API_TOKENS_PER_USER,
  MCP_TOKEN_PREFIX,
  newApiToken,
  SHOWN_PREFIX_LENGTH,
} from "#/lib/token.ts";
import { newId } from "#/lib/ulid.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { apiTokenCreateSchema } from "#/validation/accessSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";

interface TokenDeps {
  storage: StorageDriver;
  loginAttempts: LoginAttempts;
  /**
   * The token types that the features of the server permit (`TOKEN_FEATURES`).
   */
  cfg: ServerConfig;
  revocations: SessionRevocations;
}

/**
 * `/api/v1/tokens`: the personal API tokens of a user, for scripts, shortcuts
 * and bots that must not have a password. Only a session can manage them. Thus,
 * a token cannot make more tokens, or stay after its own revocation.
 *
 * The page belongs to no single feature. It contains three types of token. The
 * server makes each type only while its own feature is on. The list and the
 * revocation stay open, whatever is off. Thus, a person can always take a token
 * back.
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
      // A token stays after the session that made it.
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
      // A token that reaches notes contains their keys. Thus, the app makes it,
      // and the server gets its hash, never the secret. The secret must be of
      // this type. If not, the server would look for the token among the wrong
      // tokens when it comes.
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
      // In the one order of the list, each one time. A calendar token reaches
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
