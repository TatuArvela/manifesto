import { createHash } from "node:crypto";
import type { ApiTokenScope } from "@manifesto/shared";
import type { Context } from "hono";
import { audit } from "../audit/audit.js";
import type { SessionRevocations } from "../auth/revocations.js";
import { revokeApiToken } from "../auth/session.js";
import { nowIso } from "../lib/time.js";
import {
  hashToken,
  MCP_TOKEN_PREFIX,
  newApiToken,
  REFRESH_TOKEN_PREFIX,
  SHOWN_PREFIX_LENGTH,
  safeEqual,
} from "../lib/token.js";
import { newId } from "../lib/ulid.js";
import type { StorageDriver } from "../storage/types.js";
import { isMetadataDocumentId } from "./clients.js";
import { ACCESS_TOKEN_SECONDS, earlier, namesMcp, plusMs } from "./grants.js";

/** An error in the shape RFC 6749 gives a token endpoint. */
export const oauthError = (
  c: Context,
  status: 400 | 401,
  error: string,
  description: string,
) => {
  c.header("Cache-Control", "no-store");
  return c.json({ error, error_description: description }, status);
};

interface TokenEndpointDeps {
  storage: StorageDriver;
  revocations: SessionRevocations;
}

/**
 * `POST /api/oauth/token`, the assistant's, with no session: a code from a
 * consent traded for a grant (PKCE-checked), or a refresh token traded for
 * the next pair. A refresh token used a second time has been copied, and
 * ends the grant.
 */
export function createTokenEndpoint(deps: TokenEndpointDeps) {
  const { storage } = deps;

  /** The client id of HTTP Basic credentials, which some clients send even
   * without a secret. */
  function basicClientId(c: Context): string | undefined {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Basic ")) return undefined;
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const id = decodeURIComponent(decoded.split(":")[0] ?? "");
      return id || undefined;
    } catch {
      return undefined;
    }
  }

  function tokenResponse(
    c: Context,
    access: string,
    refreshToken: string,
    accessExpiresAt: string,
    scopes: readonly ApiTokenScope[],
  ) {
    c.header("Cache-Control", "no-store");
    return c.json({
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.max(
        1,
        Math.round((Date.parse(accessExpiresAt) - Date.parse(nowIso())) / 1000),
      ),
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    });
  }

  async function redeemCode(
    c: Context,
    clientId: string,
    field: (name: string) => string | undefined,
  ) {
    const code = field("code");
    const verifier = field("code_verifier");
    if (!code || !verifier) {
      return oauthError(
        c,
        400,
        "invalid_request",
        "code and code_verifier are required",
      );
    }
    const now = nowIso();
    const stored = await storage.oauth.redeemCode(hashToken(code), now);
    const redirectUri = field("redirect_uri");
    const invalid = () =>
      oauthError(c, 400, "invalid_grant", "The code is not good here");
    if (!stored || stored.clientId !== clientId) return invalid();
    if (redirectUri !== undefined && redirectUri !== stored.redirectUri) {
      return invalid();
    }
    // PKCE: only whoever started the sign-in holds the verifier, so a code
    // caught on its way back through the browser is worth nothing.
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      !safeEqual(challenge, stored.codeChallenge)
    ) {
      return invalid();
    }
    if (!(await storage.users.findById(stored.userId))) return invalid();

    const access = newApiToken(MCP_TOKEN_PREFIX);
    const refreshToken = newApiToken(REFRESH_TOKEN_PREFIX);
    const accessExpiresAt = earlier(
      plusMs(now, ACCESS_TOKEN_SECONDS * 1000),
      stored.grantExpiresAt,
    );
    const token = {
      id: newId(),
      name: stored.clientName,
      kind: "mcp" as const,
      scopes: stored.scopes,
      prefix: access.slice(0, SHOWN_PREFIX_LENGTH),
      createdAt: now,
      lastUsedAt: null,
      expiresAt: stored.grantExpiresAt,
      oauthClientId: stored.clientId,
      accessExpiresAt,
    };
    await storage.apiTokens.create({
      ...token,
      userId: stored.userId,
      tokenHash: hashToken(access),
      refreshHash: hashToken(refreshToken),
    });
    if (!isMetadataDocumentId(clientId)) {
      await storage.oauth.touchClient(clientId, now);
    }
    audit(storage, c, {
      action: "token.created",
      actorId: stored.userId,
      detail: {
        name: token.name,
        prefix: token.prefix,
        kind: "mcp",
        scopes: token.scopes.join(" "),
        client: clientId,
      },
    });
    return tokenResponse(
      c,
      access,
      refreshToken,
      accessExpiresAt,
      token.scopes,
    );
  }

  async function refresh(
    c: Context,
    clientId: string,
    refreshToken: string | undefined,
  ) {
    if (!refreshToken) {
      return oauthError(c, 400, "invalid_request", "refresh_token is missing");
    }
    const invalid = () =>
      oauthError(c, 400, "invalid_grant", "The refresh token is not good here");
    const hash = hashToken(refreshToken);
    const grant = await storage.apiTokens.findByRefreshHash(hash);
    if (!grant) {
      // Replaced already, so two parties hold it: the assistant, and whoever
      // copied it. Which is which cannot be told, so neither keeps the grant.
      const copied = await storage.apiTokens.findByPreviousRefreshHash(hash);
      if (copied) {
        await revokeApiToken(
          storage,
          deps.revocations,
          copied.userId,
          copied.id,
        );
        audit(storage, c, {
          action: "token.revoked",
          actorId: copied.userId,
          detail: { id: copied.id, reason: "refresh_token_reused" },
        });
      }
      return invalid();
    }
    const now = nowIso();
    if (grant.oauthClientId !== clientId) return invalid();
    if (grant.expiresAt !== null && grant.expiresAt < now) return invalid();

    const access = newApiToken(MCP_TOKEN_PREFIX);
    const next = newApiToken(REFRESH_TOKEN_PREFIX);
    const accessExpiresAt = earlier(
      plusMs(now, ACCESS_TOKEN_SECONDS * 1000),
      grant.expiresAt,
    );
    const rotated = await storage.apiTokens.rotate(hash, {
      tokenHash: hashToken(access),
      refreshHash: hashToken(next),
      accessExpiresAt,
    });
    // Another refresh with the same token won the race.
    if (!rotated) return invalid();
    await storage.apiTokens.touch(grant.id, now);
    return tokenResponse(c, access, next, accessExpiresAt, grant.scopes);
  }

  return async (c: Context) => {
    let form: Record<string, unknown>;
    try {
      form = await c.req.parseBody();
    } catch {
      return oauthError(
        c,
        400,
        "invalid_request",
        "Send a form (application/x-www-form-urlencoded)",
      );
    }
    const field = (name: string) => {
      const value = form[name];
      return typeof value === "string" && value !== "" ? value : undefined;
    };
    const clientId = field("client_id") ?? basicClientId(c);
    if (!clientId) {
      return oauthError(c, 401, "invalid_client", "client_id is missing");
    }
    const resource = field("resource");
    if (resource !== undefined && !namesMcp(resource)) {
      return oauthError(
        c,
        400,
        "invalid_target",
        "A grant here reaches /api/mcp and nothing else",
      );
    }
    const grantType = field("grant_type");
    if (grantType === "authorization_code") {
      return redeemCode(c, clientId, field);
    }
    if (grantType === "refresh_token") {
      return refresh(c, clientId, field("refresh_token"));
    }
    return oauthError(
      c,
      400,
      "unsupported_grant_type",
      "grant_type is authorization_code or refresh_token",
    );
  };
}
