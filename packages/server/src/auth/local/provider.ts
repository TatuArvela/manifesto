import type { ServerConfig } from "../../config.js";
import type { StorageDriver } from "../../storage/types.js";
import { authenticateBySession } from "../session.js";
import type {
  AuthIdentity,
  AuthProvider,
  AuthProviderRouter,
} from "../types.js";
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

    router(): AuthProviderRouter {
      return createLocalAuthRouter({ storage, authProvider: provider, cfg });
    },
  };

  return provider;
}
