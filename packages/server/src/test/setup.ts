import type { Hono } from "hono";
import { type AppDeps, createApp } from "#/app.ts";
import { createAuthProvider } from "#/auth/index.ts";
import type { AuthProvider } from "#/auth/types.ts";
import type { ServerConfig } from "#/config.ts";
import { createStorage } from "#/storage/index.ts";
import type { StorageDriver } from "#/storage/types.ts";
import type { Broadcaster } from "#/ws/broadcaster.ts";
import { sealingClient } from "./sealingClient.ts";

export const TEST_CONFIG: ServerConfig = {
  port: 0,
  dataDir: ":memory:",
  dbPath: ":memory:",
  corsOrigins: ["http://localhost:5173"],
  sessionTtlDays: 30,
  sessionAbsoluteTtlDays: 90,
  argon2MemoryKib: 8192,
  argon2TimeCost: 2,
  argon2Parallelism: 1,
  storageDriver: "sqlite",
  authProvider: "local",
  passwordForm: "shown",
  oidc: null,
  postgres: null,
  trustProxy: false,
  registrationEnabled: true,
  sharing: true,
  teams: true,
  linkPreviews: true,
  publicLinks: true,
  calendar: true,
  apiTokens: true,
  // Off. Thus, the other tests do not deliver to nothing after the storage of a
  // test closed. The webhook tests switch it on.
  webhooks: "off",
  mcp: true,
  passkeys: true,
  magicLinks: true,
  pushReminders: true,
  twoFactor: true,
  appUrl: null,
  mail: null,
  backup: null,
  metricsToken: null,
  // A key for the tests. Thus, nothing is written next to a database.
  dataEncryptionKey: "dGVzdC1zZXJ2ZXIta2V5LXRlc3Qtc2VydmVyLWtleS0",
  dataEncryptionKeyPrevious: null,
  dataKeyFile: null,
  metricsPort: null,
  metricsHost: "127.0.0.1",
  clientDir: null,
  auditRetentionDays: 180,
  // Off: no test must reach GitHub.
  updateCheckRepo: null,
  userLookup: "search",
  initialAdminPassword: null,
  defaultPrefs: {},
};

export async function bootTestAppWith(
  overrides: Partial<ServerConfig>,
  seams: Pick<AppDeps, "fetchLinkPreview"> = {},
): Promise<TestRig> {
  const cfg: ServerConfig = { ...TEST_CONFIG, ...overrides };
  const storage = await createStorage(cfg);
  const authProvider = createAuthProvider(cfg, storage);
  const { app, broadcaster } = createApp({
    cfg,
    storage,
    authProvider,
    ...seams,
  });
  return {
    cfg,
    storage,
    authProvider,
    broadcaster,
    app,
    request: sealingClient(async (input, init) => app.request(input, init)),
    rawRequest: async (input, init) => app.request(input, init),
    close: async () => storage.close(),
  };
}

export interface TestRig {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  broadcaster: Broadcaster;
  app: Hono;
  /**
   * A request as the app makes it: a note in it is sealed on the way out, and
   * the answer is opened (`sealingClient`). Thus, a test uses the words of a
   * note as its user does.
   */
  request: (input: string, init?: RequestInit) => Promise<Response>;
  /** The request exactly as given, to test what the server does with it. */
  rawRequest: (input: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

export async function bootTestApp(): Promise<TestRig> {
  // A copy. Thus, a test that switches a feature on `rig.cfg` (as a restart
  // with a different setting would) does not change the server of the next
  // test.
  const cfg = { ...TEST_CONFIG };
  const storage = await createStorage(cfg);
  const authProvider = createAuthProvider(cfg, storage);
  const { app, broadcaster } = createApp({ cfg, storage, authProvider });
  return {
    cfg,
    storage,
    authProvider,
    broadcaster,
    app,
    request: sealingClient(async (input, init) => app.request(input, init)),
    rawRequest: async (input, init) => app.request(input, init),
    close: async () => storage.close(),
  };
}

export async function registerTestUser(
  rig: TestRig,
  username = "tester",
  password = "test-pass-12",
): Promise<{ token: string; userId: string }> {
  const res = await rig.request("/api/v1/auth/register", {
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
