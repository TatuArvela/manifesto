import { Hono } from "hono";
import * as openid from "openid-client";
import type { OidcConfig, ServerConfig } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { nowIso } from "../../lib/time.js";
import { newId, newShortSuffix } from "../../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import type { CreateUserInput, StorageDriver } from "../../storage/types.js";
import { issueSession, revokeSession } from "../session.js";
import type { AuthProvider, AuthProviderRouter } from "../types.js";
import type { OidcDiscoveryClient } from "./provider.js";

interface OidcRouterDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  cfg: ServerConfig;
  oidc: OidcConfig;
  discoveryClient: OidcDiscoveryClient;
}

interface PendingFlow {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes

const AVATAR_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function pickAvatarColor(): string {
  return AVATAR_COLORS[
    Math.floor(Math.random() * AVATAR_COLORS.length)
  ] as string;
}

function providerKey(issuer: string): string {
  // Issuer is normalized at config-load time, but be defensive: trailing
  // slashes have caused account-orphaning bugs in other OIDC clients.
  return `oidc:${issuer.replace(/\/+$/, "")}`;
}

function pickUsernameSeed(claims: openid.IDToken): string {
  const preferred = (claims as Record<string, unknown>).preferred_username;
  if (typeof preferred === "string" && preferred.length > 0) return preferred;
  const email = (claims as Record<string, unknown>).email;
  if (typeof email === "string" && email.includes("@")) {
    const local = email.split("@")[0];
    if (local && local.length > 0) return local;
  }
  return claims.sub;
}

function pickDisplayName(claims: openid.IDToken, fallback: string): string {
  const name = (claims as Record<string, unknown>).name;
  if (typeof name === "string" && name.length > 0) return name;
  return fallback;
}

async function provisionUser(
  storage: StorageDriver,
  oidc: OidcConfig,
  claims: openid.IDToken,
): Promise<string> {
  const provider = providerKey(oidc.issuer);
  const externalId = claims.sub;
  const existing = await storage.users.findByExternalId(provider, externalId);
  if (existing) return existing.id;

  const seed = pickUsernameSeed(claims);
  const displayName = pickDisplayName(claims, seed);
  const baseInput: Omit<CreateUserInput, "id" | "username"> = {
    displayName,
    avatarColor: pickAvatarColor(),
    provider,
    externalId,
    passwordHash: null,
    createdAt: nowIso(),
  };

  // Try the seed first, then fall back to ULID-derived suffixes on collision.
  // The (provider, external_id) lookup is the source of truth — username is
  // just the display handle, so collisions resolve by appending a short tag.
  // We avoid the raw `sub` as a candidate because it's often an email or UUID
  // (PII leak into the username column).
  const candidates = [
    seed,
    `${seed}-${newShortSuffix()}`,
    `${seed}-${newShortSuffix()}`,
    `${seed}-${newShortSuffix()}`,
  ];
  for (const username of candidates) {
    try {
      const user = await storage.users.create({
        ...baseInput,
        id: newId(),
        username,
      });
      return user.id;
    } catch (err) {
      // Only retry on UNIQUE-constraint collisions on username. Any other
      // error (disk full, broken schema, network) propagates so it lands in
      // the operator's logs as a genuine failure rather than being masked
      // as a "username taken".
      if (!isUsernameUniqueViolation(err)) throw err;
      logger.warn("OIDC user provisioning username collision, retrying", {
        username,
      });
    }
  }
  throw new HttpError(500, "Could not provision user from IdP claims");
}

function isUsernameUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  // SQLite: "UNIQUE constraint failed: users.username"
  // Postgres: "duplicate key value violates unique constraint" + index name
  return (
    /UNIQUE constraint failed: users\.username/i.test(message) ||
    /duplicate key.*users_username/i.test(message)
  );
}

export function createOidcAuthRouter(deps: OidcRouterDeps): AuthProviderRouter {
  const auth = new Hono<{ Variables: { auth: AuthContext } }>();
  // Pending flows live in process memory. That's fine for a single-node
  // deployment, but behind a load balancer the callback may hit a different
  // instance than the one that issued the state — and the user will see
  // "Unknown or expired login state". Loudly warn operators at boot so they
  // either pin sessions to a node or move this to shared storage.
  logger.info(
    "OIDC pending-flow state is in-process; sticky sessions are required for multi-instance deployments",
  );
  const pending = new Map<string, PendingFlow>();

  function rememberFlow(state: string, codeVerifier: string): void {
    pending.set(state, { state, codeVerifier, createdAt: Date.now() });
    // Opportunistic cleanup of expired entries — bounded by the rate of
    // login attempts, so this can't pile up.
    const cutoff = Date.now() - FLOW_TTL_MS;
    for (const [key, flow] of pending) {
      if (flow.createdAt < cutoff) pending.delete(key);
    }
  }

  function consumeFlow(state: string): PendingFlow | null {
    const flow = pending.get(state);
    if (!flow) return null;
    pending.delete(state);
    if (flow.createdAt < Date.now() - FLOW_TTL_MS) return null;
    return flow;
  }

  auth.get("/login", async (c) => {
    const config = await deps.discoveryClient.getConfig();
    const codeVerifier = openid.randomPKCECodeVerifier();
    const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier);
    const state = openid.randomState();
    rememberFlow(state, codeVerifier);

    const authorizationUrl = openid.buildAuthorizationUrl(config, {
      redirect_uri: deps.oidc.redirectUri,
      scope: deps.oidc.scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });
    return c.redirect(authorizationUrl.toString(), 302);
  });

  auth.get("/callback", async (c) => {
    const url = new URL(c.req.url);
    const state = url.searchParams.get("state") ?? "";
    if (!state) {
      throw new HttpError(400, "Missing state parameter");
    }
    const flow = consumeFlow(state);
    if (!flow) {
      throw new HttpError(400, "Unknown or expired login state");
    }

    const config = await deps.discoveryClient.getConfig();
    let tokens: Awaited<ReturnType<typeof openid.authorizationCodeGrant>>;
    try {
      tokens = await openid.authorizationCodeGrant(config, url, {
        expectedState: state,
        pkceCodeVerifier: flow.codeVerifier,
        idTokenExpected: true,
      });
    } catch (err) {
      logger.warn("OIDC token exchange failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpError(401, "OIDC authentication failed");
    }

    const claims = tokens.claims();
    if (!claims?.sub) {
      throw new HttpError(401, "OIDC ID token missing subject");
    }

    const userId = await provisionUser(deps.storage, deps.oidc, claims);
    const { token } = await issueSession(deps.storage, deps.cfg, userId);

    // Token is delivered in the URL fragment so it never enters Referer
    // headers or server access logs on the client side.
    const target = new URL(deps.oidc.postLoginRedirect);
    target.hash = `token=${encodeURIComponent(token)}`;
    return c.redirect(target.toString(), 302);
  });

  auth.post("/logout", createAuthMiddleware(deps.authProvider), async (c) => {
    const { token } = c.get("auth");
    await revokeSession(deps.storage, token);
    return c.body(null, 204);
  });

  return auth;
}
