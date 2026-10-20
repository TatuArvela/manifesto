import type { ServerConfig } from "#/config.ts";
import { signsInLocally } from "#/config.ts";
import { hashPassword } from "#/lib/password.ts";
import { newTemporaryPassword } from "#/lib/temporaryPassword.ts";
import { nowIso } from "#/lib/time.ts";
import { newId, newShortSuffix } from "#/lib/ulid.ts";
import {
  type StorageDriver,
  type User,
  UsernameTakenError,
} from "#/storage/types.ts";
import { pickAvatarColor } from "./users.ts";

export const INITIAL_ADMIN_USERNAME = "admin";

export interface InitialAdmin {
  username: string;
  password: string;
  /**
   * False when an existing admin account that nobody claimed got a new
   * password.
   */
  created: boolean;
  /**
   * The password came from `INITIAL_ADMIN_PASSWORD`. Thus, the operator has it.
   */
  fromConfig: boolean;
}

/** An admin with their own password, as which a person can really sign in. */
function isSettledLocalAdmin(user: User): boolean {
  return (
    user.provider === "local" &&
    user.passwordHash !== null &&
    !user.mustChangePassword
  );
}

/**
 * Make sure that a server with local sign-in has an admin, before it accepts
 * its first request.
 *
 * When no admin has their own password (a new server, or a server whose only
 * admins sign in with an identity provider that it does not use now), this
 * gives a temporary password to an `admin` account, and returns it for the
 * caller to print. The account must select a real password at the first
 * sign-in, through the same flow as all accounts that an admin creates.
 *
 * It runs at each start until that occurs. Each run gives a new password to the
 * same unclaimed account. Thus, an operator who lost the output restarts the
 * server, and does not edit the database. When an admin has a password, this
 * does nothing. For this reason, a server that you upgrade with an existing
 * admin never gets one.
 *
 * It is not `admin`/`admin`, on purpose. The first person who tries a
 * well-known default gets it, also scanners. A mandatory password change then
 * gives the server to them. Only a person who can read the output of the server
 * knows a random password.
 *
 * With single sign-on, there is no password for a sign-in. The first person who
 * signs in becomes the admin (see `UsersRepo.create`).
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
  if (!signsInLocally(cfg)) return null;
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

  // A user can already have the name, because they registered before this ran
  // against a database that lost its admin. The code does not change their
  // account.
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
 * Show the credentials of the initial admin to the operator. It writes them
 * whatever the value of `LOG_LEVEL`, because a server on which nobody can sign
 * in is worse than one noisy line. It uses the same JSON shape as all other log
 * lines. Thus, log shippers continue to parse.
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
      // Not repeated when the operator gave it.
      temporaryPassword: admin.fromConfig
        ? "(INITIAL_ADMIN_PASSWORD)"
        : admin.password,
    }),
  );
}
