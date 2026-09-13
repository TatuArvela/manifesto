import type { ServerConfig } from "../config.js";
import { hashPassword } from "../lib/password.js";
import { newTemporaryPassword } from "../lib/temporaryPassword.js";
import { nowIso } from "../lib/time.js";
import { newId, newShortSuffix } from "../lib/ulid.js";
import {
  type StorageDriver,
  type User,
  UsernameTakenError,
} from "../storage/types.js";
import { pickAvatarColor } from "./users.js";

export const INITIAL_ADMIN_USERNAME = "admin";

export interface InitialAdmin {
  username: string;
  password: string;
  /** False when an existing, still unclaimed admin account got a new password. */
  created: boolean;
  /** The password came from `INITIAL_ADMIN_PASSWORD`, so the operator has it. */
  fromConfig: boolean;
}

/** An admin someone can actually sign in as with a password of their own. */
function isSettledLocalAdmin(user: User): boolean {
  return (
    user.provider === "local" &&
    user.passwordHash !== null &&
    !user.mustChangePassword
  );
}

/**
 * Make sure a server using local sign-in can be administered, before it
 * accepts its first request.
 *
 * When no admin has a password of their own (a new server, or one whose only
 * admins sign in with an identity provider it no longer uses), this issues a
 * temporary password for an `admin` account and returns it for the caller to
 * print. The account has to choose a real password at first sign-in, through
 * the same flow as any account an admin creates.
 *
 * It runs on every boot until that happens, and each run issues a fresh
 * password for the same unclaimed account, so an operator who lost the output
 * restarts the server rather than editing the database. Once any admin has
 * settled a password this does nothing, which is also why a server upgraded
 * with an admin already in it never gets one.
 *
 * Deliberately not `admin`/`admin`: a well-known default is claimed by
 * whoever tries it first, scanners included, and a forced password change
 * then hands the server to them. A random password is only known to whoever
 * can read the server's output.
 *
 * Under single sign-on there is no password to sign in with, and the first
 * person to sign in becomes the admin instead (see `UsersRepo.create`).
 */
export async function ensureInitialAdmin(
  storage: StorageDriver,
  cfg: Pick<
    ServerConfig,
    | "authProvider"
    | "initialAdminPassword"
    | "argon2MemoryKib"
    | "argon2TimeCost"
    | "argon2Parallelism"
  >,
): Promise<InitialAdmin | null> {
  if (cfg.authProvider !== "local") return null;
  const admins = await storage.users.listAdmins();
  if (admins.some(isSettledLocalAdmin)) return null;

  const fromConfig = cfg.initialAdminPassword !== null;
  const password = cfg.initialAdminPassword ?? newTemporaryPassword();
  const passwordHash = await hashPassword(password, cfg);

  const unclaimed = admins.find(
    (user) => user.provider === "local" && user.mustChangePassword,
  );
  if (unclaimed) {
    await storage.users.setPassword(unclaimed.id, passwordHash, true);
    return {
      username: unclaimed.username,
      password,
      created: false,
      fromConfig,
    };
  }

  // A user may already hold the name, having registered before this ran
  // against a database that had lost its admin. Their account is left alone.
  const candidates = [
    INITIAL_ADMIN_USERNAME,
    `${INITIAL_ADMIN_USERNAME}-${newShortSuffix()}`,
    `${INITIAL_ADMIN_USERNAME}-${newShortSuffix()}`,
    `${INITIAL_ADMIN_USERNAME}-${newShortSuffix()}`,
  ];
  for (const username of candidates) {
    try {
      const user = await storage.users.create({
        id: newId(),
        username,
        displayName: username,
        avatarColor: pickAvatarColor(),
        provider: "local",
        externalId: null,
        passwordHash,
        mustChangePassword: true,
        isAdmin: true,
        createdAt: nowIso(),
      });
      return { username: user.username, password, created: true, fromConfig };
    } catch (err) {
      if (!(err instanceof UsernameTakenError)) throw err;
    }
  }
  throw new Error("Could not create the initial admin account");
}

/**
 * Put the initial admin's credentials in front of the operator. Written
 * whatever `LOG_LEVEL` says, since a server nobody can sign in to is worse
 * than one noisy line, and as the same JSON shape as every other log line so
 * log shippers keep parsing.
 */
export function announceInitialAdmin(
  admin: InitialAdmin,
  write: (line: string) => void = (line) => console.error(line),
): void {
  write(
    JSON.stringify({
      ts: nowIso(),
      level: "warn",
      message: admin.created
        ? "Created the initial admin account. Sign in with this temporary password and choose your own."
        : "No admin has signed in yet. The initial admin account has a new temporary password.",
      username: admin.username,
      // Not repeated when the operator supplied it.
      temporaryPassword: admin.fromConfig
        ? "(INITIAL_ADMIN_PASSWORD)"
        : admin.password,
    }),
  );
}
