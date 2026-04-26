export type StorageDriverName = "sqlite" | "postgres";
export type AuthProviderName = "local" | "oidc";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLoginRedirect: string;
  scopes: string[];
}

export interface PostgresConfig {
  connectionString: string;
}

export interface ServerConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  corsOrigins: string[];
  sessionTtlDays: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  storageDriver: StorageDriverName;
  authProvider: AuthProviderName;
  oidc: OidcConfig | null;
  postgres: PostgresConfig | null;
}

const DEFAULT_DATA_DIR = "./data";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid integer for env var ${name}: ${raw}`);
  }
  return n;
}

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function envEnum<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(
    `Invalid value for env var ${name}: ${raw} (expected one of ${allowed.join(", ")})`,
  );
}

function envRequired(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    throw new Error(`Missing required env var ${name}`);
  }
  return raw;
}

const STORAGE_DRIVERS = [
  "sqlite",
  "postgres",
] as const satisfies readonly StorageDriverName[];
const AUTH_PROVIDERS = [
  "local",
  "oidc",
] as const satisfies readonly AuthProviderName[];

function loadPostgresConfig(): PostgresConfig {
  return {
    connectionString: envRequired("DATABASE_URL"),
  };
}

function loadOidcConfig(): OidcConfig {
  const scopes = envList("OIDC_SCOPES", ["openid", "profile", "email"]);
  return {
    issuer: envRequired("OIDC_ISSUER"),
    clientId: envRequired("OIDC_CLIENT_ID"),
    clientSecret: envRequired("OIDC_CLIENT_SECRET"),
    redirectUri: envRequired("OIDC_REDIRECT_URI"),
    postLoginRedirect: envRequired("OIDC_POST_LOGIN_REDIRECT"),
    scopes,
  };
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  const authProvider = envEnum("AUTH_PROVIDER", AUTH_PROVIDERS, "local");
  const storageDriver = envEnum("STORAGE_DRIVER", STORAGE_DRIVERS, "sqlite");
  return {
    port: envInt("PORT", 3001),
    dataDir,
    dbPath: process.env.MANIFESTO_DB ?? `${dataDir}/manifesto.db`,
    corsOrigins: envList("CORS_ORIGINS", ["http://localhost:5173"]),
    sessionTtlDays: envInt("SESSION_TTL_DAYS", 30),
    argon2MemoryKib: envInt("ARGON2_MEMORY_KIB", 19456),
    argon2TimeCost: envInt("ARGON2_TIME_COST", 2),
    argon2Parallelism: envInt("ARGON2_PARALLELISM", 1),
    storageDriver,
    authProvider,
    oidc: authProvider === "oidc" ? loadOidcConfig() : null,
    postgres: storageDriver === "postgres" ? loadPostgresConfig() : null,
  };
}
