import { authenticateBySession } from "#/auth/session.ts";
import type {
  AuthIdentity,
  AuthProvider,
  AuthProviderRouter,
  AuthRouterContext,
} from "#/auth/types.ts";
import type { ServerConfig } from "#/config.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { createLocalAuthRouter } from "./router.ts";

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
