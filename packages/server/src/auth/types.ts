import type { ApiTokenScope } from "@manifesto/shared";
import type { Hono } from "hono";
import type { Mailer } from "#/mail/mailer.ts";
import type { LoginAttempts } from "./local/loginAttempts.ts";
import type { SessionRevocations } from "./revocations.ts";

/**
 * What a bearer token was: a session from a sign-in, a personal API token, or
 * an MCP token. All actions that change the security of an account (passwords,
 * tokens, admin actions) ask for a session. Thus, a token that a script has
 * cannot take control of its account. An MCP token has fewer rights again: only
 * `/api/v1/mcp` accepts it, and the REST calls that its tools make in the
 * process (see `createAuthMiddleware`).
 */
export type CredentialKind = "session" | "api-token" | "mcp-token";

export interface AuthIdentity {
  userId: string;
  token: string;
  via: CredentialKind;
  /** What a token can reach. Absent for a session, which can reach all. */
  scopes?: readonly ApiTokenScope[];
  /** When a session signed in. Absent for a token. */
  signedInAt?: string;
  /**
   * For a token that carries keys: those keys, wrapped under a key derived from
   * the token itself. The holder of the presented token opens them for the one
   * request.
   */
  wrappedKeys?: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

// Provider routers can install their own context Variables (for example, the
// local router uses an `auth` variable for its logout handler). Those variables
// apply only to the mounted sub-app, and do not go to the host Hono instance.
// Thus, the type for the provider widens the env through `any`, on purpose.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
export type AuthProviderRouter = Hono<any, any, any>;

/**
 * Services of the app that the routes of a provider can need. The app gives
 * them when it mounts the router, not when it builds the provider.
 */
export interface AuthRouterContext {
  revocations: SessionRevocations;
  /** Null when the server sends no mail. */
  mailer: Mailer | null;
  /**
   * Wrong passwords for each account name, shared by sign-in and by the
   * confirmation of an action (`requireConfirmation`).
   */
  loginAttempts: LoginAttempts;
  /**
   * Makes the teams of a user from the identity provider agree with the groups
   * that it just gave for them (`OIDC_TEAM_GROUPS`). Absent where nothing
   * listens.
   */
  teamSync?: (userId: string, groups: string[]) => Promise<void>;
}

export interface AuthProvider {
  authenticate(token: string): Promise<AuthIdentity | null>;
  router(context: AuthRouterContext): AuthProviderRouter;
  close?(): Promise<void>;
}
