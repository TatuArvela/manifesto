import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as openid from "openid-client";
import { audit } from "../../audit/audit.js";
import type { OidcConfig, ServerConfig } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { nowIso } from "../../lib/time.js";
import { newId, newShortSuffix } from "../../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import {
  type CreateUserInput,
  EmailTakenError,
  type StorageDriver,
  UsernameTakenError,
} from "../../storage/types.js";
import { emailSchema } from "../../validation/schemas.js";
import { issueSession, revokeSession } from "../session.js";
import type { AuthProvider, AuthProviderRouter } from "../types.js";
import { pickAvatarColor } from "../users.js";
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

/**
 * Ties a callback to the browser that started the flow. Without it, `state`
 * alone only proves *someone* started a flow: an attacker can begin a login,
 * hold on to the resulting callback URL, and lure the victim into visiting it:
 * the victim's browser then gets a session for the attacker's IdP account, and
 * everything they write afterwards lands in it.
 *
 * Scoped to the auth routes and readable only by the server. `SameSite=Lax`
 * rather than `Strict` because the IdP sends the user back as a top-level
 * cross-site GET, which `Strict` would withhold. Lax is exactly the setting
 * that covers that navigation and nothing else.
 */
const FLOW_COOKIE = "manifesto_oidc_flow";
const FLOW_COOKIE_PATH = "/api/auth";

/** Insertions between sweeps of expired pending flows. */
const SWEEP_EVERY = 256;

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

/**
 * The address the identity provider vouches for, or null. One it marks as
 * unverified is not taken: an address is how a note's owner finds a person to
 * share with, and an unverified one would let anybody claim someone else's.
 */
function pickEmail(claims: openid.IDToken): string | null {
  const { email, email_verified: verified } = claims as Record<string, unknown>;
  if (typeof email !== "string" || verified === false) return null;
  const parsed = emailSchema.safeParse(email);
  return parsed.success ? parsed.data : null;
}

/**
 * Keep an account's address in step with the identity provider, which owns
 * it. One already held by another account is left where it is: which of the
 * two is right is not something a sign-in can settle.
 */
async function syncEmail(
  storage: StorageDriver,
  userId: string,
  current: string | null,
  email: string | null,
): Promise<void> {
  if (email === null || current?.toLowerCase() === email.toLowerCase()) return;
  if ((await storage.users.setEmail(userId, email)) === "email-taken") {
    logger.warn("OIDC email already belongs to another account; not stored", {
      userId,
    });
  }
}

/**
 * Why a sign-in the identity provider accepted is refused here. Sent back to
 * the client as `#error=<reason>`, which says it in the catalogue's words.
 */
export type SignInRefusal = "not_in_group" | "not_registered";

class SignInRefused extends Error {
  constructor(readonly reason: SignInRefusal) {
    super(reason);
  }
}

/**
 * The user's groups, from `claim` (a list, or one group as a string). Group
 * names are compared as the identity provider writes them.
 */
export function groupsOf(
  claims: Record<string, unknown> | undefined,
  claim: string,
): string[] | null {
  const value = claims?.[claim];
  if (Array.isArray(value)) {
    return value.filter((g): g is string => typeof g === "string");
  }
  if (typeof value === "string") return [value];
  return null;
}

async function provisionUser(
  storage: StorageDriver,
  oidc: OidcConfig,
  claims: openid.IDToken,
): Promise<string> {
  const provider = providerKey(oidc.issuer);
  const externalId = claims.sub;
  const claimedEmail = pickEmail(claims);
  const existing = await storage.users.findByExternalId(provider, externalId);
  if (existing) {
    await syncEmail(storage, existing.id, existing.email, claimedEmail);
    return existing.id;
  }
  if (!oidc.autoRegister) throw new SignInRefused("not_registered");

  const seed = pickUsernameSeed(claims);
  const displayName = pickDisplayName(claims, seed);
  const baseInput: Omit<CreateUserInput, "id" | "username"> = {
    displayName,
    avatarColor: pickAvatarColor(),
    email:
      claimedEmail && !(await storage.users.findByEmail(claimedEmail))
        ? claimedEmail
        : null,
    provider,
    externalId,
    passwordHash: null,
    createdAt: nowIso(),
  };

  // Try the seed first, then fall back to ULID-derived suffixes on collision.
  // The (provider, external_id) lookup is the source of truth; username is
  // just the display handle, so collisions resolve by appending a short tag.
  // We avoid the raw `sub` as a candidate because it's often an email or UUID
  // (PII leak into the username column).
  const candidates = [
    seed,
    `${seed}-${newShortSuffix()}`,
    `${seed}-${newShortSuffix()}`,
    `${seed}-${newShortSuffix()}`,
  ];
  /** Lost a race for the address: sign them in without one rather than not
   * at all. */
  const create = async (username: string) => {
    try {
      return await storage.users.create({
        ...baseInput,
        id: newId(),
        username,
      });
    } catch (err) {
      if (!(err instanceof EmailTakenError)) throw err;
      return await storage.users.create({
        ...baseInput,
        email: null,
        id: newId(),
        username,
      });
    }
  };
  for (const username of candidates) {
    try {
      return (await create(username)).id;
    } catch (err) {
      // Only retry on UNIQUE-constraint collisions on username. Any other
      // error (disk full, broken schema, network) propagates so it lands in
      // the operator's logs as a genuine failure rather than being masked
      // as a "username taken".
      if (!(err instanceof UsernameTakenError)) throw err;
      logger.warn("OIDC user provisioning username collision, retrying", {
        username,
      });
    }
  }
  throw new HttpError(500, "Could not provision user from IdP claims");
}

export function createOidcAuthRouter(deps: OidcRouterDeps): AuthProviderRouter {
  const auth = new Hono<{ Variables: { auth: AuthContext } }>();
  // Pending flows live in process memory. That's fine for a single-node
  // deployment, but behind a load balancer the callback may hit a different
  // instance than the one that issued the state, and the user will see
  // "Unknown or expired login state". Loudly warn operators at boot so they
  // either pin sessions to a node or move this to shared storage.
  logger.info(
    "OIDC pending-flow state is in-process; sticky sessions are required for multi-instance deployments",
  );
  const pending = new Map<string, PendingFlow>();

  // Per-IP budget on the two unauthenticated endpoints. `/login` mints a
  // pending flow and `/callback` spends discovery and a token exchange, so
  // without this an anonymous caller sets the memory and outbound-request
  // cost of the process. Looser than the local provider's 10, which is sized
  // against password spraying: there is no password here, a single sign-in
  // costs two requests, and SSO users routinely share an egress IP.
  const authThrottle = rateLimit({
    limit: 30,
    windowMs: 15 * 60 * 1000,
    trustProxy: deps.cfg.trustProxy,
  });

  let sinceSweep = 0;

  function rememberFlow(state: string, codeVerifier: string): void {
    pending.set(state, { state, codeVerifier, createdAt: Date.now() });
    // Sweep expired entries every SWEEP_EVERY insertions rather than on each
    // one: walking the whole map per login made a burst quadratic. Amortized
    // to O(1) per insert, and at most SWEEP_EVERY stale entries are held
    // between sweeps. Same idiom as `middleware/rateLimit.ts`, and for the
    // same reason it is a counter and not a timer, with nothing to tear down.
    if (++sinceSweep < SWEEP_EVERY) return;
    sinceSweep = 0;
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

  auth.get("/login", authThrottle, async (c) => {
    const config = await deps.discoveryClient.getConfig();
    const codeVerifier = openid.randomPKCECodeVerifier();
    const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier);
    const state = openid.randomState();
    rememberFlow(state, codeVerifier);
    setCookie(c, FLOW_COOKIE, state, {
      httpOnly: true,
      sameSite: "Lax",
      // The callback is whatever scheme the deployment redirects to; marking
      // the cookie Secure over plain http would mean the browser never sends
      // it back and every login would fail.
      secure: deps.oidc.redirectUri.startsWith("https:"),
      path: FLOW_COOKIE_PATH,
      maxAge: FLOW_TTL_MS / 1000,
    });

    const authorizationUrl = openid.buildAuthorizationUrl(config, {
      redirect_uri: deps.oidc.redirectUri,
      scope: deps.oidc.scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });
    return c.redirect(authorizationUrl.toString(), 302);
  });

  auth.get("/callback", authThrottle, async (c) => {
    const url = new URL(c.req.url);
    const state = url.searchParams.get("state") ?? "";
    if (!state) {
      throw new HttpError(400, "Missing state parameter");
    }

    // Checked before the flow is consumed, so a forged callback can't burn
    // the pending state of a login someone else has in progress.
    const boundState = getCookie(c, FLOW_COOKIE);
    deleteCookie(c, FLOW_COOKIE, { path: FLOW_COOKIE_PATH });
    if (!boundState || boundState !== state) {
      logger.warn("OIDC callback rejected: not the browser that began login", {
        hasCookie: boundState !== undefined,
      });
      throw new HttpError(400, "Login state does not match this browser");
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

    const target = new URL(deps.oidc.postLoginRedirect);
    const { adminGroup, userGroup, groupsClaim } = deps.oidc;

    // Groups only matter when a group is configured. Many identity providers
    // leave them out of the ID token unless asked, so userinfo is asked when
    // the token does not carry the claim.
    let groups: string[] | null = null;
    if (adminGroup || userGroup) {
      groups = groupsOf(claims as Record<string, unknown>, groupsClaim);
      if (groups === null) {
        try {
          const info = await openid.fetchUserInfo(
            config,
            tokens.access_token,
            claims.sub,
          );
          groups = groupsOf(info as Record<string, unknown>, groupsClaim);
        } catch (err) {
          logger.warn("OIDC userinfo could not be read for groups", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (groups === null) {
        logger.warn("OIDC groups claim missing; treating as no groups", {
          claim: groupsClaim,
        });
      }
    }

    let userId: string;
    try {
      if (userGroup && !(groups ?? []).includes(userGroup)) {
        throw new SignInRefused("not_in_group");
      }
      userId = await provisionUser(deps.storage, deps.oidc, claims);
    } catch (err) {
      if (!(err instanceof SignInRefused)) throw err;
      logger.info("OIDC sign-in refused", { reason: err.reason });
      audit(deps.storage, c, {
        action: "auth.sign_in_failed",
        detail: { method: "oidc", reason: err.reason, subject: claims.sub },
      });
      target.hash = `error=${err.reason}`;
      return c.redirect(target.toString(), 302);
    }

    // Admin follows the group at every sign-in, both ways, so taking someone
    // out of the group at the identity provider takes admin away here. The
    // last admin is kept, as it is everywhere else.
    if (adminGroup) {
      const wanted = (groups ?? []).includes(adminGroup);
      const user = await deps.storage.users.findById(userId);
      if (user && user.isAdmin !== wanted) {
        const result = await deps.storage.users.setAdmin(userId, wanted);
        if (result === "ok") {
          audit(deps.storage, c, {
            action: wanted ? "admin.admin_granted" : "admin.admin_revoked",
            targetId: userId,
            detail: { by: "oidc_group" },
          });
        }
        if (result === "last-admin") {
          logger.warn("OIDC admin group would remove the last admin; kept", {
            userId,
          });
        }
      }
    }

    const { token } = await issueSession(deps.storage, deps.cfg, userId);
    audit(deps.storage, c, {
      action: "auth.signed_in",
      actorId: userId,
      detail: { method: "oidc" },
    });
    // Token is delivered in the URL fragment so it never enters Referer
    // headers or server access logs on the client side.
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
