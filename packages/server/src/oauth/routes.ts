import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import type {
  OAuthAuthorizeResponse,
  OAuthClientInfo,
} from "@manifesto/shared";
import { Hono } from "hono";
import { requireConfirmation } from "../auth/confirmation.js";
import type { LoginAttempts } from "../auth/local/loginAttempts.js";
import type { SessionRevocations } from "../auth/revocations.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { hashToken, MAX_API_TOKENS_PER_USER } from "../lib/token.js";
import { newId } from "../lib/ulid.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import {
  oauthAuthorizeSchema,
  oauthRegisterSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import {
  MAX_CLIENT_NAME_LENGTH,
  type ResolvedClient,
  UNNAMED_CLIENT,
} from "./clients.js";
import { CODE_TTL_MS, GRANT_TYPES, plusMs, requestedScopes } from "./grants.js";
import { redirectUriMatches, redirectUriProblem } from "./redirectUris.js";
import { createTokenEndpoint, oauthError } from "./tokenEndpoint.js";

export {
  MCP_OAUTH_SCOPES,
  requestedScopes,
  UNUSED_CLIENT_DAYS,
} from "./grants.js";
export {
  createWellKnownRoutes,
  resourceMetadataChallenge,
} from "./wellKnown.js";

interface OAuthDeps {
  storage: StorageDriver;
  loginAttempts: LoginAttempts;
  revocations: SessionRevocations;
  resolveClient: (clientId: string) => Promise<ResolvedClient | null>;
}

/**
 * `/api/oauth`: an OAuth 2.1 authorization server for `/api/mcp` and nothing
 * else. A grant is an `mcp` API token with a refresh token beside it, so it
 * is listed in Settings, revoked there, and ended with the user's sessions
 * like any token; its access token (`mfm_`) lasts an hour and each refresh
 * replaces both. A refresh token used a second time has been copied, and ends
 * the grant (`tokenEndpoint.ts`).
 *
 * `register` and `token` are the assistant's, with no session. `client` and
 * `authorize` are the consent page's, with the user's session, and
 * `authorize` asks for the password as minting a token by hand does.
 */
export function createOAuthRoutes(deps: OAuthDeps) {
  const { storage } = deps;
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();

  routes.post("/register", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return oauthError(c, 400, "invalid_client_metadata", "Send JSON");
    }
    const parsed = oauthRegisterSchema.safeParse(raw);
    if (!parsed.success) {
      return oauthError(
        c,
        400,
        "invalid_client_metadata",
        parsed.error.issues[0]?.message ?? "Invalid metadata",
      );
    }
    const meta = parsed.data;
    for (const uri of meta.redirect_uris) {
      const problem = redirectUriProblem(uri);
      if (problem) {
        return oauthError(
          c,
          400,
          "invalid_redirect_uri",
          `${uri.slice(0, 200)} ${problem}`,
        );
      }
    }
    if (
      meta.grant_types &&
      (!meta.grant_types.includes("authorization_code") ||
        meta.grant_types.some((type) => !GRANT_TYPES.includes(type)))
    ) {
      return oauthError(
        c,
        400,
        "invalid_client_metadata",
        "Only authorization_code and refresh_token are granted",
      );
    }
    if (meta.response_types?.some((type) => type !== "code")) {
      return oauthError(
        c,
        400,
        "invalid_client_metadata",
        "Only the code response type is supported",
      );
    }
    // Every client here is a public one: an assistant on someone's computer
    // cannot keep a secret. RFC 7591 lets the server answer with the method
    // it will use instead of the one asked for.
    const client = {
      id: newId(),
      name:
        meta.client_name?.trim().slice(0, MAX_CLIENT_NAME_LENGTH) ||
        UNNAMED_CLIENT,
      redirectUris: meta.redirect_uris,
      createdAt: nowIso(),
      lastUsedAt: null,
    };
    await storage.oauth.createClient(client);
    return c.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: GRANT_TYPES,
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  });

  routes.post("/token", createTokenEndpoint(deps));

  /** The client and redirect address a consent is about, checked. */
  async function consentClient(
    clientId: string | undefined,
    redirectUri: string | undefined,
  ): Promise<ResolvedClient> {
    if (!clientId || !redirectUri) {
      throw new HttpError(400, "client_id and redirect_uri are required");
    }
    const client = await deps.resolveClient(clientId);
    if (!client) throw new HttpError(400, "No such client");
    if (!redirectUriMatches(client.redirectUris, redirectUri)) {
      throw new HttpError(400, "The client did not register that address");
    }
    return client;
  }

  routes.get("/client", async (c) => {
    const redirectUri = c.req.query("redirect_uri");
    const client = await consentClient(c.req.query("client_id"), redirectUri);
    const scopes = requestedScopes(c.req.query("scope"));
    if (scopes.length === 0) {
      throw new HttpError(400, "It asks for nothing an assistant can be given");
    }
    const body: OAuthClientInfo = {
      clientId: client.id,
      name: client.name,
      publisher: client.publisher,
      redirectUri: redirectUri as string,
      scopes,
    };
    return c.json(body);
  });

  routes.post(
    "/authorize",
    zValidator("json", oauthAuthorizeSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      // A grant outlives the session that gave it, as a token does.
      await requireConfirmation(deps, auth, body.password);
      const client = await consentClient(body.clientId, body.redirectUri);
      const existing = await storage.apiTokens.listByUser(auth.userId);
      if (existing.length >= MAX_API_TOKENS_PER_USER) {
        throw new HttpError(409, "Revoke a token before creating another");
      }
      const code = randomBytes(32).toString("base64url");
      await storage.oauth.createCode({
        codeHash: hashToken(code),
        clientId: client.id,
        clientName: client.name,
        userId: auth.userId,
        redirectUri: body.redirectUri,
        codeChallenge: body.codeChallenge,
        scopes: requestedScopes(body.scopes.join(" ")),
        grantExpiresAt:
          body.expiresInDays === undefined
            ? null
            : isoPlusDays(body.expiresInDays),
        expiresAt: plusMs(nowIso(), CODE_TTL_MS),
      });
      const target = new URL(body.redirectUri);
      target.searchParams.set("code", code);
      if (body.state !== undefined)
        target.searchParams.set("state", body.state);
      const answer: OAuthAuthorizeResponse = { redirectTo: target.href };
      return c.json(answer);
    },
  );

  return routes;
}
