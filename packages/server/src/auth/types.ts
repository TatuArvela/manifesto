import type { Hono } from "hono";
import type { Mailer } from "../mail/mailer.js";
import type { SessionRevocations } from "./revocations.js";

/**
 * What a bearer token turned out to be: a session from signing in, or a
 * personal API token. Anything that changes how an account is secured
 * (passwords, tokens, admin actions) asks for a session, so a token handed to
 * a script cannot be used to take over the account it belongs to.
 */
export type CredentialKind = "session" | "api-token";

export interface AuthIdentity {
  userId: string;
  token: string;
  via: CredentialKind;
  username: string;
  displayName: string;
  avatarColor: string;
}

// Provider routers may install their own context Variables (e.g. the local
// router uses an `auth` variable for its logout handler). Those variables are
// scoped to the mounted sub-app and do not leak to the host Hono instance, so
// the provider-facing type intentionally widens the env via `any`.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
export type AuthProviderRouter = Hono<any, any, any>;

/** Services the app owns that a provider's routes may need, handed over when
 * the router is mounted rather than when the provider is built. */
export interface AuthRouterContext {
  revocations: SessionRevocations;
  /** Null when the server sends no mail. */
  mailer: Mailer | null;
}

export interface AuthProvider {
  authenticate(token: string): Promise<AuthIdentity | null>;
  router(context: AuthRouterContext): AuthProviderRouter;
  close?(): Promise<void>;
}
