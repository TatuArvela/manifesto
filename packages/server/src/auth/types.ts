import type { Hono } from "hono";

export interface AuthIdentity {
  userId: string;
  token: string;
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

export interface AuthProvider {
  authenticate(token: string): Promise<AuthIdentity | null>;
  router(): AuthProviderRouter;
  close?(): Promise<void>;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

export interface AuthSuccess {
  token: string;
  user: PublicUser;
}
