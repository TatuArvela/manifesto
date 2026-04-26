import type { Hono } from "hono";
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import type { AuthProvider } from "../auth/types.js";
import type { ServerConfig } from "../config.js";
import { createStorage } from "../storage/index.js";
import type { StorageDriver } from "../storage/types.js";
import type { Broadcaster } from "../ws/broadcaster.js";

export const TEST_CONFIG: ServerConfig = {
  port: 0,
  dataDir: ":memory:",
  dbPath: ":memory:",
  corsOrigins: ["http://localhost:5173"],
  sessionTtlDays: 30,
  argon2MemoryKib: 8192,
  argon2TimeCost: 2,
  argon2Parallelism: 1,
  storageDriver: "sqlite",
  authProvider: "local",
};

export interface TestRig {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  broadcaster: Broadcaster;
  app: Hono;
  request: (input: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

export function bootTestApp(): TestRig {
  const cfg = TEST_CONFIG;
  const storage = createStorage(cfg);
  const authProvider = createAuthProvider(cfg, storage);
  const { app, broadcaster } = createApp({ cfg, storage, authProvider });
  return {
    cfg,
    storage,
    authProvider,
    broadcaster,
    app,
    request: async (input, init) => app.request(input, init),
    close: async () => storage.close(),
  };
}

export async function registerTestUser(
  rig: TestRig,
  username = "tester",
  password = "test-pass-12",
): Promise<{ token: string; userId: string }> {
  const res = await rig.request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 201) {
    const body = await res.text();
    throw new Error(`register failed with status ${res.status}: ${body}`);
  }
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

export function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}
