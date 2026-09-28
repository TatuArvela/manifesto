import { createHash, randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import type {
  ApiTokenScope,
  OAuthAuthorizeResponse,
  OAuthClientInfo,
} from "@manifesto/shared";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { audit } from "../audit/audit.js";
import { requireConfirmation } from "../auth/confirmation.js";
import type { LoginAttempts } from "../auth/local/loginAttempts.js";
import type { SessionRevocations } from "../auth/revocations.js";
import { revokeApiToken } from "../auth/session.js";
import type { AuthProvider } from "../auth/types.js";
import type { ServerConfig } from "../config.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import {
  hashToken,
  MAX_API_TOKENS_PER_USER,
  MCP_TOKEN_PREFIX,
  newApiToken,
  REFRESH_TOKEN_PREFIX,
  SHOWN_PREFIX_LENGTH,
  safeEqual,
} from "../lib/token.js";
import { newId } from "../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import { rateLimit } from "../middleware/rateLimit.js";
import type { StorageDriver } from "../storage/types.js";
import {
  oauthAuthorizeSchema,
  oauthRegisterSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import {
  isMetadataDocumentId,
  MAX_CLIENT_NAME_LENGTH,
  type ResolvedClient,
  UNNAMED_CLIENT,
} from "./clients.js";
import { redirectUriMatches, redirectUriProblem } from "./redirectUris.js";

/** What an assistant can be given: its tools reach notes and nothing else. */
export const MCP_OAUTH_SCOPES = [
  "notes:read",
  "notes:write",
] as const satisfies readonly ApiTokenScope[];

/** How long an access token works before the refresh token is needed. */
const ACCESS_TOKEN_SECONDS = 60 * 60;

/** How long the code a consent hands out can be traded for a grant. */
const CODE_TTL_MS = 2 * 60 * 1000;

/** A client that registered and has not been given a grant within this long
 * is swept (`jobs/sessionCleanup.ts`). */
export const UNUSED_CLIENT_DAYS = 1;

const GRANT_TYPES = ["authorization_code", "refresh_token"];

/**
 * This server's own address as the client reached it. Behind a proxy with
 * `TRUST_PROXY` on, the scheme and host the proxy was reached at, since an
 * assistant that asked `https://notes.example` for metadata refuses an issuer
 * named `http://10.0.0.5:3001`.
 */
export function publicOrigin(c: Context, trustProxy: boolean): string {
  const url = new URL(c.req.url);
  if (trustProxy) {
    const proto = c.req.header("X-Forwarded-Proto")?.split(",")[0].trim();
    const host = c.req.header("X-Forwarded-Host")?.split(",")[0].trim();
    if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
    if (host) url.host = host;
  }
  return url.origin;
}

/**
 * `notes:read`, with `notes:write` when it was asked for, from a space-separated
 * `scope`; both when none was named. Empty when it names nothing an assistant
 * can have.
 */
export function requestedScopes(scope: string | undefined): ApiTokenScope[] {
  const names = (scope ?? "").split(/\s+/).filter(Boolean);
  if (names.length === 0) return [...MCP_OAUTH_SCOPES];
  if (names.includes("notes:write")) return [...MCP_OAUTH_SCOPES];
  return names.includes("notes:read") ? ["notes:read"] : [];
}

type WellKnownConfig = Pick<ServerConfig, "appUrl" | "trustProxy">;

/**
 * `/.well-known/`: how an assistant that was given only `/api/mcp` finds out
 * how to sign in there (RFC 9728, then RFC 8414). The consent page is the
 * client's, so the authorization endpoint is on its address, not this one.
 */
export function createWellKnownRoutes(cfg: WellKnownConfig) {
  const routes = new Hono();
  const protectedResource = (c: Context) => {
    const origin = publicOrigin(c, cfg.trustProxy);
    return c.json({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: MCP_OAUTH_SCOPES,
      bearer_methods_supported: ["header"],
    });
  };
  routes.get("/oauth-protected-resource", protectedResource);
  routes.get("/oauth-protected-resource/api/mcp", protectedResource);
  routes.get("/oauth-authorization-server", (c) => {
    const origin = publicOrigin(c, cfg.trustProxy);
    return c.json({
      issuer: origin,
      authorization_endpoint: `${cfg.appUrl ?? origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      scopes_supported: MCP_OAUTH_SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
    });
  });
  return routes;
}

/**
 * On `/api/mcp`: a 401 says where the metadata is, which is how an assistant
 * given only the address learns it can sign in (RFC 9728, section 5.1).
 */
export function resourceMetadataChallenge(
  trustProxy: boolean,
): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.res.status !== 401) return;
    const origin = publicOrigin(c, trustProxy);
    c.res.headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
    );
  };
}

/** Whether a `resource` names `/api/mcp`, the one thing a grant reaches. */
function namesMcp(resource: string): boolean {
  try {
    return new URL(resource).pathname.replace(/\/+$/, "") === "/api/mcp";
  } catch {
    return false;
  }
}

/** An ISO timestamp `ms` after another. Expiries are counted from `nowIso`,
 * which they are compared with, and which never goes back. */
function plusMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

/** The earlier of two ISO timestamps, a null one being never. */
function earlier(a: string, b: string | null): string {
  return b !== null && b < a ? b : a;
}

interface OAuthDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  loginAttempts: LoginAttempts;
  revocations: SessionRevocations;
  trustProxy: boolean;
  resolveClient: (clientId: string) => Promise<ResolvedClient | null>;
  /** Per user, after sign-in: the consent page's two calls. */
  rateLimit?: MiddlewareHandler;
}

/**
 * `/api/oauth`: an OAuth 2.1 authorization server for `/api/mcp` and nothing
 * else. A grant is an `mcp` API token with a refresh token beside it, so it
 * is listed in Settings, revoked there, and ended with the user's sessions
 * like any token; its access token (`mfm_`) lasts an hour and each refresh
 * replaces both. A refresh token used a second time has been copied, and ends
 * the grant.
 *
 * `register` and `token` are the assistant's, with no session. `client` and
 * `authorize` are the consent page's, with the user's session, and
 * `authorize` asks for the password as minting a token by hand does.
 */
export function createOAuthRoutes(deps: OAuthDeps) {
  const { storage } = deps;
  const routes = new Hono<{ Variables: { auth: AuthContext } }>();
  const noLimit: MiddlewareHandler = (_c, next) => next();
  const session = createAuthMiddleware(deps.authProvider, {
    sessionOnly: true,
  });

  /** An error in the shape RFC 6749 gives a token endpoint. */
  const oauthError = (
    c: Context,
    status: 400 | 401,
    error: string,
    description: string,
  ) => {
    c.header("Cache-Control", "no-store");
    return c.json({ error, error_description: description }, status);
  };

  routes.post(
    "/register",
    rateLimit({
      limit: 20,
      windowMs: 60 * 60 * 1000,
      trustProxy: deps.trustProxy,
      name: "oauth-register",
    }),
    async (c) => {
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
    },
  );

  routes.post(
    "/token",
    rateLimit({
      limit: 60,
      windowMs: 60 * 1000,
      trustProxy: deps.trustProxy,
      name: "oauth-token",
    }),
    async (c) => {
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
    },
  );

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

  routes.get("/client", session, deps.rateLimit ?? noLimit, async (c) => {
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
    session,
    deps.rateLimit ?? noLimit,
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
