import { Hono } from "hono";
import type { ServerConfig } from "#/config.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { createLocalAuthProvider } from "./local/provider.ts";
import { createOidcAuthProvider } from "./oidc/provider.ts";
import { authenticateBySession } from "./session.ts";
import type { AuthProvider } from "./types.ts";

function oidcConfigOf(cfg: ServerConfig) {
  if (!cfg.oidc) {
    throw new Error(
      "OIDC config missing: set OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URI / OIDC_POST_LOGIN_REDIRECT",
    );
  }
  return cfg.oidc;
}

/**
 * Both types of sign-in at the same time. Sessions are the same, whatever the
 * method of the sign-in (`auth/session.ts`). Thus, authentication is shared,
 * and the two routers mount together: `POST /login`, `/register` and the
 * password routes of local, and `GET /login` and `/callback` of OIDC. Both
 * define the same `POST /logout`. The local one, mounted first, answers it.
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

export type { AuthIdentity, AuthProvider } from "./types.ts";
