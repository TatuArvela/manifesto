import type { ServerConfig } from "../config.js";
import type { StorageDriver } from "../storage/types.js";
import { createLocalAuthProvider } from "./local/provider.js";
import { createOidcAuthProvider } from "./oidc/provider.js";
import type { AuthProvider } from "./types.js";

export function createAuthProvider(
  cfg: ServerConfig,
  storage: StorageDriver,
): AuthProvider {
  switch (cfg.authProvider) {
    case "local":
      return createLocalAuthProvider({ storage, cfg });
    case "oidc": {
      if (!cfg.oidc) {
        throw new Error(
          "OIDC config missing — set OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URI / OIDC_POST_LOGIN_REDIRECT",
        );
      }
      return createOidcAuthProvider({ storage, cfg, oidc: cfg.oidc });
    }
    default: {
      const exhaustive: never = cfg.authProvider;
      throw new Error(`Unknown auth provider: ${String(exhaustive)}`);
    }
  }
}

export type { AuthIdentity, AuthProvider } from "./types.js";
