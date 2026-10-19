import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as openid from "openid-client";
import { audit } from "#/audit/audit.ts";
import { issueSession, revokeSession } from "#/auth/session.ts";
import type { AuthProviderRouter } from "#/auth/types.ts";
import { pickAvatarColor } from "#/auth/users.ts";
import type { OidcConfig, ServerConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import { nowIso } from "#/lib/time.ts";
import { newId, newShortSuffix } from "#/lib/ulid.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import {
  type CreateUserInput,
  EmailTakenError,
  type StorageDriver,
  UsernameTakenError,
} from "#/storage/types.ts";
import { emailSchema } from "#/validation/accountSchemas.ts";
import type { OidcDiscoveryClient } from "./provider.ts";

interface OidcRouterDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
  oidc: OidcConfig;
  discoveryClient: OidcDiscoveryClient;
  teamSync?: ((userId: string, groups: string[]) => Promise<void>) | undefined;
}

interface PendingFlow {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Ties a callback to the browser that started the flow. Without it, `state`
 * alone only proves that *a person* started a flow. An attacker can start a
 * login, keep the callback URL, and make the victim open it. The browser of the
 * victim then gets a session for the IdP account of the attacker, and all that
 * the victim writes after that goes into it.
 *
 * It applies only to the auth routes, and only the server can read it. It is
 * `SameSite=Lax`, not `Strict`, because the IdP sends the user back as a
 * top-level cross-site GET, and `Strict` would not send the cookie. Lax is
 * exactly the setting that covers that navigation and nothing else.
 */
const FLOW_COOKIE = "manifesto_oidc_flow";
const FLOW_COOKIE_PATH = "/api/v1/auth";

/** Insertions between sweeps of expired pending flows. */
const SWEEP_EVERY = 256;

function providerKey(issuer: string): string {
  // The config load normalizes the issuer, but be careful: trailing slashes
  // caused bugs in other OIDC clients that lost the link to accounts.
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
 * The address for which the identity provider vouches, or null. The code never
 * takes an address that the provider marks as unverified. A note owner finds a
 * person for a share by an address, and an unverified address would let any
 * person claim the address of a different person. An address about which the
 * provider says nothing is also not vouched for, because some providers do not
 * send the claim for an address that the user typed.
 * `OIDC_UNVERIFIED_EMAIL=accept` takes those, for a provider that gives out
 * only addresses that it controls.
 */
function pickEmail(
  claims: openid.IDToken,
  acceptUnstated: boolean,
): string | null {
  const { email, email_verified: verified } = claims as Record<string, unknown>;
  if (typeof email !== "string" || verified === false) return null;
  if (verified !== true && !acceptUnstated) return null;
  const parsed = emailSchema.safeParse(email);
  return parsed.success ? parsed.data : null;
}

/**
 * Keep the address of an account the same as at the identity provider, which
 * owns it. If a different account already has the address, the code does not
 * change it. A sign-in cannot decide which of the two is correct.
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
 * Why the server refuses here a sign-in that the identity provider accepted. It
 * goes back to the client as `#error=<reason>`, which shows it in the words of
 * the catalogue.
 */
export type SignInRefusal =
  | "not_in_group"
  | "not_registered"
  | "groups_unavailable";

class SignInRefused extends Error {
  constructor(readonly reason: SignInRefusal) {
    super(reason);
  }
}

/**
 * The groups of the user, from `claim` (a list, or one group as a string). The
 * code compares group names as the identity provider writes them.
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
  const claimedEmail = pickEmail(claims, oidc.acceptUnverifiedEmail);
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

  // Try the seed first. On a collision, use suffixes from a ULID. The
  // (provider, external_id) lookup is the source of truth. The username is only
  // the display handle. Thus, a collision gets a short tag at the end. We do
  // not use the raw `sub` as a candidate, because it is frequently an email or
  // a UUID (personal data in the username column).
  const candidates = [
    seed,
    `${seed}-${newShortSuffix()}`,
    `${seed}-${newShortSuffix()}`,
    `${seed}-${newShortSuffix()}`,
  ];
  /**
   * A different sign-in got the address first. Sign them in without an address,
   * not refuse the sign-in.
   */
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
      // Try again only on UNIQUE-constraint collisions on the username. All
      // other errors (full disk, broken schema, network) go up. Thus, they go
      // into the logs of the operator as real failures, and do not look like
      // "username taken".
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
  // Pending flows are in process memory. That is acceptable for a deployment on
  // one node. But behind a load balancer, the callback can go to a different
  // instance than the instance that gave the state. The user then sees "Unknown
  // or expired login state". Show a clear warning to operators at start. Thus,
  // they pin sessions to a node, or move this to shared storage.
  logger.info(
    "OIDC pending-flow state is in-process; sticky sessions are required for multi-instance deployments",
  );
  const pending = new Map<string, PendingFlow>();

  let sinceSweep = 0;

  function rememberFlow(state: string, codeVerifier: string): void {
    pending.set(state, { state, codeVerifier, createdAt: Date.now() });
    // Sweep expired entries each SWEEP_EVERY insertions, not on each one. A
    // walk through the full map on each login made a burst quadratic. This
    // makes it O(1) on average for each insert. A maximum of SWEEP_EVERY stale
    // entries stay between sweeps. This is the same method as in
    // `middleware/rateLimit.ts`. For the same reason, it is a counter, not a
    // timer, and there is nothing to tear down.
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

  auth.get("/login", async (c) => {
    const config = await deps.discoveryClient.getConfig();
    const codeVerifier = openid.randomPKCECodeVerifier();
    const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier);
    const state = openid.randomState();
    rememberFlow(state, codeVerifier);
    setCookie(c, FLOW_COOKIE, state, {
      httpOnly: true,
      sameSite: "Lax",
      // The callback uses the scheme to which the deployment redirects. If the
      // cookie were Secure over plain http, the browser would never send it
      // back, and each login would fail.
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
      // An action that needs a recent sign-in (`auth/confirmation.ts`) sends
      // the user back here with `reauth`. The identity provider must ask again.
      // It must not use the session that it already has.
      ...(c.req.query("reauth") !== undefined && { prompt: "login" }),
    });
    return c.redirect(authorizationUrl.toString(), 302);
  });

  auth.get("/callback", async (c) => {
    const url = new URL(c.req.url);
    const state = url.searchParams.get("state") ?? "";
    if (!state) {
      throw new HttpError(400, "Missing state parameter");
    }

    // Checked before the flow is used. Thus, a forged callback cannot use up
    // the pending state of a login that a different person started.
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
    const { adminGroup, userGroup, groupsClaim, teamGroups } = deps.oidc;
    const mirrorsTeams = teamGroups !== null && deps.teamSync !== undefined;

    // Groups are only important when a group is configured. Many identity
    // providers do not put them in the ID token unless asked. Thus, the code
    // asks userinfo when the token does not contain the claim. If the code
    // could not read userinfo, the groups are unknown. That is not the same as
    // no groups. It refuses a sign-in that the user group controls, and keeps
    // admin rights as they were. If not, an outage at the identity provider
    // would remove admin rights from all persons who signed in.
    let groups: string[] | null = null;
    let groupsUnknown = false;
    if (adminGroup || userGroup || mirrorsTeams) {
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
          groupsUnknown = true;
          logger.warn("OIDC userinfo could not be read for groups", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (groups === null && !groupsUnknown) {
        logger.warn("OIDC groups claim missing; treating as no groups", {
          claim: groupsClaim,
        });
      }
    }

    let userId: string;
    try {
      if (userGroup && groupsUnknown) {
        throw new SignInRefused("groups_unavailable");
      }
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

    // Admin rights follow the group at each sign-in, in both directions. Thus,
    // when a person is removed from the group at the identity provider, they
    // lose admin rights here. The last admin stays, as in all other places.
    if (adminGroup && !groupsUnknown) {
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

    // Teams follow the groups at each sign-in, as admin rights do. If the code
    // could not read the groups, the teams stay as they were. They do not
    // become empty.
    if (mirrorsTeams && !groupsUnknown && deps.teamSync) {
      const named = groups ?? [];
      const mirrored =
        teamGroups === "*"
          ? named
          : named.filter((group) => teamGroups?.includes(group));
      try {
        await deps.teamSync(userId, mirrored);
      } catch (err) {
        // The sign-in stays. The teams update the next time.
        logger.warn("OIDC team sync failed", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const { token } = await issueSession(deps.storage, deps.cfg, userId);
    audit(deps.storage, c, {
      action: "auth.signed_in",
      actorId: userId,
      detail: { method: "oidc" },
    });
    // The token goes in the URL fragment. Thus, it never goes into Referer
    // headers or into the access logs of the server on the client side.
    target.hash = `token=${encodeURIComponent(token)}`;
    return c.redirect(target.toString(), 302);
  });

  auth.post("/logout", async (c) => {
    const { token } = c.get("auth");
    await revokeSession(deps.storage, token);
    return c.body(null, 204);
  });

  return auth;
}
