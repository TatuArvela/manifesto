import type { ServerConfig } from "../config.js";
import type { StorageDriver } from "../storage/types.js";
import { createLocalAuthProvider } from "./local/provider.js";
import type { AuthProvider } from "./types.js";

export function createAuthProvider(
  cfg: ServerConfig,
  storage: StorageDriver,
): AuthProvider {
  switch (cfg.authProvider) {
    case "local":
      return createLocalAuthProvider({ storage, cfg });
    default: {
      const exhaustive: never = cfg.authProvider;
      throw new Error(`Unknown auth provider: ${String(exhaustive)}`);
    }
  }
}

export type { AuthIdentity, AuthProvider } from "./types.js";
