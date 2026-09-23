import { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import type { StorageDriver } from "../storage/types.js";
import { createLocalAuthProvider } from "./local/provider.js";
import { createOidcAuthProvider } from "./oidc/provider.js";
import { authenticateBySession } from "./session.js";
import type { AuthProvider } from "./types.js";

function oidcConfigOf(cfg: ServerConfig) {
  if (!cfg.oidc) {
    throw new Error(
      "OIDC config missing: set OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URI / OIDC_POST_LOGIN_REDIRECT",
    );
  }
  return cfg.oidc;
}

/**
 * Both kinds of sign-in at once. Sessions are the same whichever way someone
 * signed in (`auth/session.ts`), so authentication is shared, and the two
 * routers are mounted side by side: local's `POST /login`, `/register` and
 * the password routes, OIDC's `GET /login` and `/callback`. Both define
 * `POST /logout` identically; local's, mounted first, answers it.
 */
function createCombinedAuthProvider(
  cfg: ServerConfig,
  storage: StorageDriver,
): AuthProvider {
  const local = createLocalAuthProvider({ storage, cfg });
  const oidc = createOidcAuthProvider({
    storage,
    cfg,
    oidc: oidcConfigOf(cfg),
  });
  const provider: AuthProvider = {
    authenticate: (token) => authenticateBySession(storage, cfg, token),
    router(context) {
      const router = new Hono();
      router.route("/", local.router(context));
      router.route("/", oidc.router(context));
      return router;
    },
    async close() {
      await local.close?.();
      await oidc.close?.();
    },
  };
  return provider;
}

export function createAuthProvider(
  cfg: ServerConfig,
  storage: StorageDriver,
): AuthProvider {
  switch (cfg.authProvider) {
    case "local":
      return createLocalAuthProvider({ storage, cfg });
    case "oidc":
      return createOidcAuthProvider({ storage, cfg, oidc: oidcConfigOf(cfg) });
    case "both":
      return createCombinedAuthProvider(cfg, storage);
    default: {
      const exhaustive: never = cfg.authProvider;
      throw new Error(`Unknown auth provider: ${String(exhaustive)}`);
    }
  }
}

export type { AuthIdentity, AuthProvider } from "./types.js";
