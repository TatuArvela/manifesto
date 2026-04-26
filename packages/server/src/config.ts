export interface ServerConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  corsOrigins: string[];
  sessionTtlDays: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
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

export function loadConfig(): ServerConfig {
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  return {
    port: envInt("PORT", 3001),
    dataDir,
    dbPath: process.env.MANIFESTO_DB ?? `${dataDir}/manifesto.db`,
    corsOrigins: envList("CORS_ORIGINS", ["http://localhost:5173"]),
    sessionTtlDays: envInt("SESSION_TTL_DAYS", 30),
    argon2MemoryKib: envInt("ARGON2_MEMORY_KIB", 19456),
    argon2TimeCost: envInt("ARGON2_TIME_COST", 2),
    argon2Parallelism: envInt("ARGON2_PARALLELISM", 1),
  };
}
