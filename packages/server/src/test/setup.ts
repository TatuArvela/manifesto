import type { Hono } from "hono";
import { type AppDeps, createApp } from "../app.js";
import type { ServerConfig } from "../config.js";
import { type DB, openDatabase } from "../db/index.js";

export const TEST_CONFIG: ServerConfig = {
  port: 0,
  dataDir: ":memory:",
  dbPath: ":memory:",
  corsOrigins: ["http://localhost:5173"],
  sessionTtlDays: 30,
  argon2MemoryKib: 8192,
  argon2TimeCost: 2,
  argon2Parallelism: 1,
};

export interface TestRig {
  db: DB;
  cfg: ServerConfig;
  app: Hono;
  deps: AppDeps;
  request: (input: string, init?: RequestInit) => Promise<Response>;
}

export function bootTestApp(): TestRig {
  const db = openDatabase(":memory:");
  const cfg = TEST_CONFIG;
  const result = createApp({ db, cfg });
  const app = result.app;
  const request = async (input: string, init?: RequestInit) =>
    app.request(input, init);
  return { db, cfg, app, deps: { db, cfg }, request };
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
