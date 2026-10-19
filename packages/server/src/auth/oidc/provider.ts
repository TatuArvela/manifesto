import * as openid from "openid-client";
import { authenticateBySession } from "#/auth/session.ts";
import type {
  AuthIdentity,
  AuthProvider,
  AuthProviderRouter,
} from "#/auth/types.ts";
import type { OidcConfig, ServerConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { createOidcAuthRouter } from "./router.ts";

export interface OidcDiscoveryClient {
  getConfig(): Promise<openid.Configuration>;
}

interface OidcAuthProviderDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
  oidc: OidcConfig;
  // Test seam: lets tests inject a stub of openid-client, without real
  // discovery against a network.
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

    router(context): AuthProviderRouter {
      return createOidcAuthRouter({
        storage,
        cfg,
        oidc,
        discoveryClient,
        teamSync: context?.teamSync,
      });
    },
  };

  return provider;
}
