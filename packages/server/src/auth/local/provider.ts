import type { ServerConfig } from "../../config.js";
import { isoPlusDays, nowIso } from "../../lib/time.js";
import type { StorageDriver } from "../../storage/types.js";
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
      if (!token) return null;
      const session = await storage.sessions.findByToken(token);
      if (!session) return null;
      const now = nowIso();
      if (session.expiresAt < now) {
        await storage.sessions.deleteByToken(token);
        return null;
      }
      const user = await storage.users.findById(session.userId);
      if (!user) return null;
      await storage.sessions.touch(token, now, isoPlusDays(cfg.sessionTtlDays));
      return {
        userId: user.id,
        token,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarColor: user.avatarColor,
      };
    },

    router(): AuthProviderRouter {
      return createLocalAuthRouter({ storage, authProvider: provider, cfg });
    },
  };

  return provider;
}
