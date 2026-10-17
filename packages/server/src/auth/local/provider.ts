import { authenticateBySession } from "#/auth/session.js";
import type {
  AuthIdentity,
  AuthProvider,
  AuthProviderRouter,
  AuthRouterContext,
} from "#/auth/types.js";
import type { ServerConfig } from "#/config.js";
import type { StorageDriver } from "#/storage/types.js";
import { createLocalAuthRouter } from "./router.js";

interface LocalAuthProviderDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
}

export function createLocalAuthProvider(
  deps: LocalAuthProviderDeps,
): AuthProvider {
  const { storage, cfg } = deps;

  const provider: AuthProvider = {
    async authenticate(token: string): Promise<AuthIdentity | null> {
      return authenticateBySession(storage, cfg, token);
    },

    router({
      revocations,
      mailer,
      loginAttempts,
    }: AuthRouterContext): AuthProviderRouter {
      return createLocalAuthRouter({
        storage,
        cfg,
        revocations,
        mailer,
        loginAttempts,
      });
    },
  };

  return provider;
}
