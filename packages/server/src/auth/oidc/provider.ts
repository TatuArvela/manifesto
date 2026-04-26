import * as openid from "openid-client";
import type { OidcConfig, ServerConfig } from "../../config.js";
import { logger } from "../../lib/logger.js";
import type { StorageDriver } from "../../storage/types.js";
import { authenticateBySession } from "../session.js";
import type {
  AuthIdentity,
  AuthProvider,
  AuthProviderRouter,
} from "../types.js";
import { createOidcAuthRouter } from "./router.js";

export interface OidcDiscoveryClient {
  getConfig(): Promise<openid.Configuration>;
}

interface OidcAuthProviderDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
  oidc: OidcConfig;
  // Test seam: lets tests inject a stubbed openid-client without going through
  // real discovery against a network.
  discoveryClient?: OidcDiscoveryClient;
}

function defaultDiscoveryClient(oidc: OidcConfig): OidcDiscoveryClient {
  let cached: Promise<openid.Configuration> | null = null;
  return {
    getConfig() {
      if (!cached) {
        cached = openid
          .discovery(new URL(oidc.issuer), oidc.clientId, oidc.clientSecret)
          .catch((err) => {
            cached = null;
            logger.error("OIDC discovery failed", {
              issuer: oidc.issuer,
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          });
      }
      return cached;
    },
  };
}

export function createOidcAuthProvider(
  deps: OidcAuthProviderDeps,
): AuthProvider {
  const { storage, cfg, oidc } = deps;
  const discoveryClient = deps.discoveryClient ?? defaultDiscoveryClient(oidc);

  const provider: AuthProvider = {
    async authenticate(token: string): Promise<AuthIdentity | null> {
      return authenticateBySession(storage, cfg, token);
    },

    router(): AuthProviderRouter {
      return createOidcAuthRouter({
        storage,
        authProvider: provider,
        cfg,
        oidc,
        discoveryClient,
      });
    },
  };

  return provider;
}
