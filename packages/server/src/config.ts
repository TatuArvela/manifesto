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
  /** The claim holding the user's groups (`OIDC_GROUPS_CLAIM`). */
  groupsClaim: string;
  /** Members are admins, and anyone else is not, from each sign-in on. */
  adminGroup: string | null;
  /** When set, only members may sign in at all. */
  userGroup: string | null;
  /** When false, only identities that already have an account sign in. */
  autoRegister: boolean;
}

export interface MailConfig {
  /** `smtp://` (STARTTLS when offered) or `smtps://`, with credentials. */
  url: string;
  /** The From header, `Notes <notes@example.com>` or a bare address. */
  from: string;
  /** The client's public address, which links in mail point at. */
  appUrl: string;
}

export interface PostgresConfig {
  connectionString: string;
}

export interface ServerConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  corsOrigins: string[];
  /** Inactivity timeout: a session's expiry slides this far forward on every
   * authenticated request. */
  sessionTtlDays: number;
  /** Hard end-of-life measured from when the session was minted. A session in
   * daily use would otherwise slide forward forever, so a token stolen once
   * stays valid indefinitely. */
  sessionAbsoluteTtlDays: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  storageDriver: StorageDriverName;
  /**
   * How people sign in: `local` (username and password), `oidc` (single
   * sign-on), or `both` side by side. `signsInLocally` / `signsInWithOidc`
   * are the questions to ask of it.
   */
  authProvider: AuthMode;
  /**
   * With `both`, whether the password form is on the sign-in screen as it
   * is, or folded behind a link under the single sign-on button, for servers
   * where SSO is the way in and local accounts are the admin's spare key.
   */
  passwordForm: PasswordFormMode;
  oidc: OidcConfig | null;
  postgres: PostgresConfig | null;
  /** When true, the rate limiter (and any future IP-aware logic) honors
   * `X-Forwarded-For`. Set this only when running behind a trusted reverse
   * proxy that overwrites the header; otherwise an attacker can rotate the
   * value to defeat per-IP throttling. */
  trustProxy: boolean;
  /** When false, POST /api/auth/register returns 403. Defaults to true to
   * preserve open-signup behavior; set to false for managed-mode deployments
   * where accounts are provisioned out-of-band. */
  registrationEnabled: boolean;
  /** When false, the server never fetches a URL for a link preview, and the
   * client keeps the plain link card. Off is for deployments with no outbound
   * internet access, or an egress policy that should not be asked. */
  linkPreviews: boolean;
  /**
   * Whether users may register webhooks, and where they may point: `public`
   * addresses only (the default, the same rule as link previews), `private`
   * to also reach the local network (a Home Assistant or n8n beside the
   * server), or `off`.
   */
  webhooks: WebhookMode;
  /**
   * Outgoing mail, for password reset links and share invitations. Null
   * without `SMTP_URL`, and then an admin's temporary password stays the only
   * way back into a local account.
   */
  mail: MailConfig | null;
  /** Days the audit log keeps an entry. */
  auditRetentionDays: number;
  /** The GitHub repository whose releases the update check reads, or null
   * with `UPDATE_CHECK=off`. */
  updateCheckRepo: string | null;
  /** How someone sharing a note finds the account to share it with: by
   * searching every account as they type, or only by its exact username or
   * email address, which keeps the list of accounts private. */
  userLookup: UserLookupMode;
  /** The temporary password to give the initial admin account instead of a
   * generated one, for deployments that cannot read the server's output. It
   * still has to be changed at first sign-in. */
  initialAdminPassword: string | null;
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

/** Whether accounts with passwords can sign in on this server. */
export function signsInLocally(cfg: Pick<ServerConfig, "authProvider">) {
  return cfg.authProvider !== "oidc";
}

/** Whether single sign-on is offered on this server. */
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
  // Held to the same minimum as any password, so the account it creates can
  // actually be signed in to.
  if (raw.length < 8 || raw.length > 256) {
    throw new Error(
      "Invalid INITIAL_ADMIN_PASSWORD: must be 8 to 256 characters",
    );
  }
  return raw;
}

function loadMailConfig(): MailConfig | null {
  const url = process.env.SMTP_URL?.trim();
  if (!url) return null;
  if (!/^smtps?:\/\//i.test(url)) {
    throw new Error("Invalid SMTP_URL: must start with smtp:// or smtps://");
  }
  const appUrl = envRequired("APP_URL").replace(/\/+$/, "");
  try {
    new URL(appUrl);
  } catch {
    throw new Error("Invalid APP_URL: must be the client's full URL");
  }
  return { url, from: envRequired("SMTP_FROM"), appUrl };
}

function loadOidcConfig(): OidcConfig {
  const scopes = envList("OIDC_SCOPES", ["openid", "profile", "email"]);
  // Normalize the issuer URL once at boot. The issuer is part of the user
  // provider key (`oidc:<issuer>`); changing it via trailing slash, scheme
  // case, or default port silently orphans every existing OIDC user.
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
    autoRegister: envBool("OIDC_AUTO_REGISTER", true),
  };
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  const authProvider = envEnum("AUTH_PROVIDER", AUTH_MODES, "local");
  const storageDriver = envEnum("STORAGE_DRIVER", STORAGE_DRIVERS, "sqlite");
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
    linkPreviews: envBool("LINK_PREVIEWS", true),
    webhooks: envEnum("WEBHOOKS", WEBHOOK_MODES, "public"),
    mail: loadMailConfig(),
    auditRetentionDays: envInt("AUDIT_RETENTION_DAYS", 180),
    updateCheckRepo: envBool("UPDATE_CHECK", true)
      ? process.env.UPDATE_CHECK_REPO?.trim() || "TatuArvela/manifesto"
      : null,
    userLookup: envEnum("USER_LOOKUP", USER_LOOKUP_MODES, "search"),
    initialAdminPassword: loadInitialAdminPassword(),
  };
}
