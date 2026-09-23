import { fileURLToPath } from "node:url";
import { audit } from "./audit/audit.js";
import { createSessionRevocations } from "./auth/revocations.js";
import { endUserSessions } from "./auth/session.js";
import { pickAvatarColor } from "./auth/users.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { hashPassword } from "./lib/password.js";
import { newTemporaryPassword } from "./lib/temporaryPassword.js";
import { nowIso } from "./lib/time.js";
import { newId } from "./lib/ulid.js";
import { createStorage } from "./storage/index.js";
import { type StorageDriver, UsernameTakenError } from "./storage/types.js";

/**
 * Lockout recovery from a shell on the server, for when no admin can sign in:
 * the last one forgot their password, lost their authenticator and their
 * recovery codes, or the identity provider no longer knows them. Run inside
 * the container, against the same database and environment as the server:
 *
 *     docker exec manifesto-server node dist/cli.js reset-password admin
 *
 * It works on the database directly, so it needs nothing from the running
 * server. Sessions it ends are refused at the next request; a socket the
 * server already holds stays until it reconnects.
 */

export const USAGE = `Usage: node dist/cli.js <command> [username]

Commands:
  list-admins                  List every admin account.
  reset-password <username>    Give a local account a temporary password (printed
                               here), end its sessions and API tokens, and turn
                               off its two-factor sign-in.
  make-admin <username>        Make an account an admin.
  create-admin <username>      Create a local admin account with a temporary
                               password (printed here).`;

export interface CliContext {
  storage: StorageDriver;
  cfg: Pick<
    ServerConfig,
    "argon2MemoryKib" | "argon2TimeCost" | "argon2Parallelism"
  >;
  out: (line: string) => void;
}

/** Runs one command; resolves with the exit code. */
export async function runCli(
  args: string[],
  { storage, cfg, out }: CliContext,
): Promise<number> {
  const [command, username] = args;

  const findUser = async () => {
    if (!username) {
      out(`${command} needs a username.\n\n${USAGE}`);
      return null;
    }
    const user = await storage.users.findByUsername(username);
    if (!user) out(`No account is called ${username}.`);
    return user;
  };

  switch (command) {
    case "list-admins": {
      const admins = await storage.users.listAdmins();
      if (admins.length === 0) out("There are no admins.");
      for (const admin of admins) {
        out(
          `${admin.username}\t${admin.provider === "local" ? "password" : "single sign-on"}${admin.email ? `\t${admin.email}` : ""}`,
        );
      }
      return 0;
    }

    case "reset-password": {
      const user = await findUser();
      if (!user) return 1;
      if (user.provider !== "local") {
        out(
          `${user.username} signs in through single sign-on and has no password here.`,
        );
        return 1;
      }
      const password = newTemporaryPassword();
      await storage.users.setPassword(
        user.id,
        await hashPassword(password, cfg),
        true,
      );
      await endUserSessions(storage, createSessionRevocations(), user.id);
      await storage.twoFactor.disable(user.id);
      audit(storage, null, {
        action: "admin.password_reset",
        targetId: user.id,
        detail: { by: "cli" },
      });
      out(`Temporary password for ${user.username}: ${password}`);
      out("It has to be changed at the next sign-in.");
      return 0;
    }

    case "make-admin": {
      const user = await findUser();
      if (!user) return 1;
      if (user.isAdmin) {
        out(`${user.username} is already an admin.`);
        return 0;
      }
      await storage.users.setAdmin(user.id, true);
      audit(storage, null, {
        action: "admin.admin_granted",
        targetId: user.id,
        detail: { by: "cli" },
      });
      out(`${user.username} is now an admin.`);
      return 0;
    }

    case "create-admin": {
      if (!username) {
        out(`create-admin needs a username.\n\n${USAGE}`);
        return 1;
      }
      const password = newTemporaryPassword();
      try {
        const user = await storage.users.create({
          id: newId(),
          username,
          displayName: username,
          avatarColor: pickAvatarColor(),
          provider: "local",
          externalId: null,
          passwordHash: await hashPassword(password, cfg),
          mustChangePassword: true,
          isAdmin: true,
          createdAt: nowIso(),
        });
        audit(storage, null, {
          action: "admin.user_created",
          targetId: user.id,
          detail: { by: "cli" },
        });
        out(`Created admin ${user.username}. Temporary password: ${password}`);
        out("It has to be changed at the first sign-in.");
        return 0;
      } catch (err) {
        if (err instanceof UsernameTakenError) {
          out(`An account is already called ${username}.`);
          return 1;
        }
        throw err;
      }
    }

    default:
      out(USAGE);
      return command === undefined || command === "help" ? 0 : 1;
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const storage = await createStorage(cfg);
  try {
    process.exitCode = await runCli(process.argv.slice(2), {
      storage,
      cfg,
      out: (line) => console.log(line),
    });
    // Audit writes are fire-and-forget; give them a moment before closing.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    await storage.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
