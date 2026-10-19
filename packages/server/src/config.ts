import { readFileSync } from "node:fs";
import { type AccountPrefs, MAX_ACCOUNT_PREFS_BYTES } from "@manifesto/shared";
import {
  FEATURES,
  type FeatureToggles,
  isFeatureOn,
  loadFeatureToggles,
} from "./features.ts";
export type StorageDriverName = "sqlite" | "postgres";
export type AuthProviderName = "local" | "oidc";
export type UserLookupMode = "search" | "exact";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLoginRedirect: string;
  scopes: string[];
  /** The claim that contains the groups of the user (`OIDC_GROUPS_CLAIM`). */
  groupsClaim: string;
  /**
   * Members are admins, and all other persons are not, from each sign-in on.
   */
  adminGroup: string | null;
  /** When set, only members can sign in. */
  userGroup: string | null;
  /**
   * The groups mirrored as teams (`OIDC_TEAM_GROUPS`): these names, all groups
   * (`*`), or none (null, the default). The groups of a directory can be
   * hundreds, and most of them mean nothing for note sharing.
   */
  teamGroups: string[] | "*" | null;
  /** When false, only identities that already have an account can sign in. */
  autoRegister: boolean;
  /**
   * If the server also takes an address for which the identity provider does
   * not vouch (`OIDC_UNVERIFIED_EMAIL=accept`). When off, it takes only
   * `email_verified: true`. A provider that does not send the claim did not
   * say.
   */
  acceptUnverifiedEmail: boolean;
}

export interface BackupConfig {
  intervalHours: number;
  /** The number of backups to keep. The server deletes older backups. */
  keep: number;
  dir: string;
}

export interface MailConfig {
  /** `smtp://` (STARTTLS when available) or `smtps://`, with credentials. */
  url: string;
  /** The From header, `Notes <notes@example.com>`, or only an address. */
  from: string;
  /** The public address of the client, to which links in mail point. */
  appUrl: string;
}

export interface PostgresConfig {
  connectionString: string;
}

/**
 * The settings of the server. The features that a host can turn off are kept
 * under their own names (`FeatureToggles`, described in `features.ts`). Code
 * asks about them through `isFeatureOn`, which also knows the requirements of
 * each one.
 */
export interface ServerConfig extends FeatureToggles {
  port: number;
  dataDir: string;
  dbPath: string;
  corsOrigins: string[];
  /**
   * The inactivity timeout: the expiry of a session slides this far forward on
   * each authenticated request.
   */
  sessionTtlDays: number;
  /**
   * The hard end of life, from the time when the session was made. If not, a
   * session in daily use would slide forward forever. Thus, a token that a
   * person stole one time would stay valid permanently.
   */
  sessionAbsoluteTtlDays: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  storageDriver: StorageDriverName;
  /**
   * How people sign in: `local` (username and password), `oidc` (single
   * sign-on), or `both` together. Use `signsInLocally` / `signsInWithOidc` to
   * ask about it.
   */
  authProvider: AuthMode;
  /**
   * With `both`: if the password form shows on the sign-in screen, or is folded
   * behind a link under the single sign-on button. Use the second for servers
   * where SSO is the usual way in, and local accounts are the spare key of the
   * admin.
   */
  passwordForm: PasswordFormMode;
  oidc: OidcConfig | null;
  postgres: PostgresConfig | null;
  /**
   * When true, the rate limiter (and all future logic that uses the IP) uses
   * `X-Forwarded-For`. Set this only behind a trusted reverse proxy that
   * overwrites the header. If not, an attacker can change the value to avoid
   * the throttle for each IP.
   */
  trustProxy: boolean;
  /**
   * When false, POST /api/v1/auth/register returns 403. The default is true, to
   * keep open sign-up. Set it to false for managed-mode deployments, where
   * accounts come from a different process.
   */
  registrationEnabled: boolean;
  /**
   * If users can register webhooks, and where they can point: only `public`
   * addresses (the default, the same rule as for link previews), `private` to
   * also reach the local network (a Home Assistant or n8n near the server), or
   * `off`. This is the only feature of `FEATURES` with modes.
   */
  webhooks: WebhookMode;
  /**
   * The public address of the client (`APP_URL`), without a slash at the end,
   * or null. Mail links point to it. An assistant that signs in to
   * `/api/v1/mcp` goes to its consent page there. With `CLIENT_DIR` and no
   * `APP_URL`, the client is the origin of this server.
   */
  appUrl: string | null;
  /**
   * Outgoing mail, for password reset links and share invitations. Null without
   * `SMTP_URL`. Then a temporary password from an admin is the only way back
   * into a local account.
   */
  mail: MailConfig | null;
  /** A built client to serve at the site root with the API, or null. */
  clientDir: string | null;
  /** The bearer token for which `GET /metrics` asks. Null keeps it off. */
  metricsToken: string | null;
  /**
   * The server key, under which the server stores the few values that it reads
   * by itself (`storage/atRest.ts`): 32 bytes in base64 or hex. Null keeps it
   * in `dataKeyFile`, made at the first start.
   */
  dataEncryptionKey: string | null;
  /** The previous key, while the server moves the values of a replaced key. */
  dataEncryptionKeyPrevious: string | null;
  /**
   * Where the server keeps the key when it is not given. Null for
   * `${dataDir}/server.key`.
   */
  dataKeyFile: string | null;
  /**
   * A separate port for `/metrics`, not the public port, or null. When it is
   * set, the main port never serves metrics.
   */
  metricsPort: number | null;
  /** Where that listener binds: loopback, unless a different value is given. */
  metricsHost: string;
  /** Scheduled SQLite backups, or null when off (the default). */
  backup: BackupConfig | null;
  /** The days that the audit log keeps an entry. */
  auditRetentionDays: number;
  /**
   * The GitHub repository whose releases the update check reads, or null with
   * `UPDATE_CHECK=off`.
   */
  updateCheckRepo: string | null;
  /**
   * How a person who shares a note finds the account for the share: a search of
   * all accounts while they type, or only by its exact username or email
   * address, which keeps the list of accounts private.
   */
  userLookup: UserLookupMode;
  /**
   * The temporary password for the initial admin account, in place of a
   * generated password. It is for deployments that cannot read the output of
   * the server. The user must still change it at the first sign-in.
   */
  initialAdminPassword: string | null;
  /**
   * The preferences of a new account, with the keys of the client
   * (`DEFAULT_PREFS`), or empty. The client uses each one for a key that the
   * account never stored, in place of its own default. The server never reads a
   * value, as it never reads the own values of an account.
   */
  defaultPrefs: AccountPrefs;
}

const DEFAULT_DATA_DIR = "./data";

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`Invalid boolean for env var ${name}: ${raw}`);
}

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
export const WEBHOOK_MODES = ["off", "public", "private"] as const;
export type WebhookMode = (typeof WEBHOOK_MODES)[number];

const USER_LOOKUP_MODES = [
  "search",
  "exact",
] as const satisfies readonly UserLookupMode[];
export type AuthMode = AuthProviderName | "both";
const AUTH_MODES = [
  "local",
  "oidc",
  "both",
] as const satisfies readonly AuthMode[];

export const PASSWORD_FORM_MODES = ["shown", "collapsed"] as const;
export type PasswordFormMode = (typeof PASSWORD_FORM_MODES)[number];

/** If accounts with passwords can sign in on this server. */
export function signsInLocally(cfg: Pick<ServerConfig, "authProvider">) {
  return cfg.authProvider !== "oidc";
}

/** If this server offers single sign-on. */
export function signsInWithOidc(cfg: Pick<ServerConfig, "authProvider">) {
  return cfg.authProvider !== "local";
}

function loadPostgresConfig(): PostgresConfig {
  return {
    connectionString: envRequired("DATABASE_URL"),
  };
}

function loadInitialAdminPassword(): string | null {
  const raw = process.env.INITIAL_ADMIN_PASSWORD;
  if (raw === undefined || raw === "") return null;
  // It has the same minimum as all passwords. Thus, a person can really sign in
  // to the account that it creates.
  if (raw.length < 8 || raw.length > 256) {
    throw new Error(
      "Invalid INITIAL_ADMIN_PASSWORD: must be 8 to 256 characters",
    );
  }
  return raw;
}

function loadBackupConfig(dataDir: string): BackupConfig | null {
  const intervalHours = envInt("BACKUP_INTERVAL_HOURS", 0);
  if (intervalHours <= 0) return null;
  const keep = envInt("BACKUP_KEEP", 7);
  if (keep < 1) throw new Error("Invalid BACKUP_KEEP: must be at least 1");
  return {
    intervalHours,
    keep,
    dir: process.env.BACKUP_DIR?.trim() || `${dataDir}/backups`,
  };
}

/**
 * `DEFAULT_PREFS`: a JSON object of preferences. The server refuses it at start
 * when it is not an object, or is larger than the own preferences of an account
 * can be. It does not give it to each client to refuse.
 */
export function parseDefaultPrefs(raw: string | undefined): AccountPrefs {
  const value = raw?.trim();
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid DEFAULT_PREFS: not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid DEFAULT_PREFS: must be a JSON object");
  }
  if (Buffer.byteLength(JSON.stringify(parsed)) > MAX_ACCOUNT_PREFS_BYTES) {
    throw new Error(
      `Invalid DEFAULT_PREFS: larger than ${MAX_ACCOUNT_PREFS_BYTES} bytes`,
    );
  }
  return parsed as AccountPrefs;
}

function loadAppUrl(): string | null {
  const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!appUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error("Invalid APP_URL: must be the client's full URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Invalid APP_URL: must be an http(s) address");
  }
  return appUrl;
}

function loadMailConfig(appUrl: string | null): MailConfig | null {
  const url = process.env.SMTP_URL?.trim();
  if (!url) return null;
  if (!/^smtps?:\/\//i.test(url)) {
    throw new Error("Invalid SMTP_URL: must start with smtp:// or smtps://");
  }
  if (appUrl === null) {
    throw new Error("Missing required env var APP_URL");
  }
  return { url, from: envRequired("SMTP_FROM"), appUrl };
}

function loadOidcConfig(): OidcConfig {
  const scopes = envList("OIDC_SCOPES", ["openid", "profile", "email"]);
  // Normalize the issuer URL one time at start. The issuer is part of the
  // provider key of the user (`oidc:<issuer>`). If it changes through a
  // trailing slash, the case of the scheme, or a default port, all existing
  // OIDC users silently lose their accounts.
  const issuer = envRequired("OIDC_ISSUER").replace(/\/+$/, "");
  return {
    issuer,
    clientId: envRequired("OIDC_CLIENT_ID"),
    clientSecret: envRequired("OIDC_CLIENT_SECRET"),
    redirectUri: envRequired("OIDC_REDIRECT_URI"),
    postLoginRedirect: envRequired("OIDC_POST_LOGIN_REDIRECT"),
    scopes,
    groupsClaim: process.env.OIDC_GROUPS_CLAIM?.trim() || "groups",
    adminGroup: process.env.OIDC_ADMIN_GROUP?.trim() || null,
    userGroup: process.env.OIDC_USER_GROUP?.trim() || null,
    teamGroups: parseTeamGroups(process.env.OIDC_TEAM_GROUPS),
    autoRegister: envBool("OIDC_AUTO_REGISTER", true),
    acceptUnverifiedEmail:
      envEnum("OIDC_UNVERIFIED_EMAIL", ["refuse", "accept"], "refuse") ===
      "accept",
  };
}

/** `OIDC_TEAM_GROUPS`: a list of group names separated by commas, or `*`. */
export function parseTeamGroups(
  raw: string | undefined,
): string[] | "*" | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value === "*") return "*";
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 ? names : null;
}

/**
 * `FOO_FILE=/run/secrets/foo` as the value of `FOO`, for the settings that are
 * secrets. This is the convention with which Docker and Kubernetes mount
 * secrets (the official Postgres image also reads it). Only for those settings:
 * an environment has other variables that end in `_FILE` (`COMPOSE_FILE`),
 * which are not ours. The code removes the newline at the end of the file,
 * because editors add one. The code refuses `FOO` and `FOO_FILE` together, and
 * does not guess.
 */
export const FILE_SECRETS = [
  "DATABASE_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "SMTP_URL",
  "METRICS_TOKEN",
  "INITIAL_ADMIN_PASSWORD",
  "DATA_ENCRYPTION_KEY",
  "DATA_ENCRYPTION_KEY_PREVIOUS",
] as const;

export function resolveFileSecrets(
  env: NodeJS.ProcessEnv,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): void {
  for (const name of FILE_SECRETS) {
    const key = `${name}_FILE`;
    const path = env[key];
    if (!path) continue;
    if (env[name] !== undefined && env[name] !== "") {
      throw new Error(`Set ${name} or ${key}, not both`);
    }
    let value: string;
    try {
      value = read(path);
    } catch (err) {
      throw new Error(
        `Cannot read ${key} (${path}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    env[name] = value.replace(/\r?\n$/, "");
  }
}

export function loadConfig(): ServerConfig {
  resolveFileSecrets(process.env);
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  const authProvider = envEnum("AUTH_PROVIDER", AUTH_MODES, "local");
  const storageDriver = envEnum("STORAGE_DRIVER", STORAGE_DRIVERS, "sqlite");
  const appUrl = loadAppUrl();
  const webhooks = envEnum(
    FEATURES.webhooks.env,
    WEBHOOK_MODES,
    FEATURES.webhooks.default as WebhookMode,
  );
  return {
    port: envInt("PORT", 3001),
    dataDir,
    dbPath: process.env.MANIFESTO_DB ?? `${dataDir}/manifesto.db`,
    corsOrigins: envList("CORS_ORIGINS", ["http://localhost:5173"]),
    sessionTtlDays: envInt("SESSION_TTL_DAYS", 30),
    sessionAbsoluteTtlDays: envInt("SESSION_ABSOLUTE_TTL_DAYS", 90),
    argon2MemoryKib: envInt("ARGON2_MEMORY_KIB", 19456),
    argon2TimeCost: envInt("ARGON2_TIME_COST", 2),
    argon2Parallelism: envInt("ARGON2_PARALLELISM", 1),
    storageDriver,
    authProvider,
    passwordForm: envEnum("PASSWORD_FORM", PASSWORD_FORM_MODES, "shown"),
    oidc: authProvider !== "local" ? loadOidcConfig() : null,
    postgres: storageDriver === "postgres" ? loadPostgresConfig() : null,
    trustProxy: envBool("TRUST_PROXY", false),
    registrationEnabled: envBool("REGISTRATION_ENABLED", true),
    webhooks,
    ...loadFeatureToggles(process.env, envBool, webhooks !== "off"),
    appUrl,
    mail: loadMailConfig(appUrl),
    backup: loadBackupConfig(dataDir),
    metricsToken: process.env.METRICS_TOKEN?.trim() || null,
    dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY?.trim() || null,
    dataEncryptionKeyPrevious:
      process.env.DATA_ENCRYPTION_KEY_PREVIOUS?.trim() || null,
    dataKeyFile: process.env.DATA_KEY_FILE?.trim() || null,
    metricsPort:
      envInt("METRICS_PORT", 0) > 0 ? envInt("METRICS_PORT", 0) : null,
    metricsHost: process.env.METRICS_HOST?.trim() || "127.0.0.1",
    clientDir: process.env.CLIENT_DIR?.trim() || null,
    auditRetentionDays: envInt("AUDIT_RETENTION_DAYS", 180),
    updateCheckRepo: envBool("UPDATE_CHECK", true)
      ? process.env.UPDATE_CHECK_REPO?.trim() || "TatuArvela/manifesto"
      : null,
    userLookup: envEnum("USER_LOOKUP", USER_LOOKUP_MODES, "exact"),
    initialAdminPassword: loadInitialAdminPassword(),
    defaultPrefs: parseDefaultPrefs(process.env.DEFAULT_PREFS),
  };
}

/**
 * If an assistant can connect to `/api/v1/mcp` through a sign-in in the browser
 * (OAuth): MCP is on, and the server can send the user to the client, whose
 * page asks the user (`APP_URL`, or served here).
 */
export function offersMcpSignIn(cfg: ServerConfig): boolean {
  return (
    isFeatureOn(cfg, "mcp") && (cfg.appUrl !== null || cfg.clientDir !== null)
  );
}
