import { zValidator } from "@hono/zod-validator";
import type {
  AdminOverviewResponse,
  AdminTemporaryPasswordResponse,
  AdminUpdateResponse,
  AdminUser,
  AdminUserResponse,
  AdminUsersResponse,
  AuditLogResponse,
} from "@manifesto/shared";
import { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { auditPage } from "#/audit/auditPage.ts";
import type { SessionRevocations } from "#/auth/revocations.ts";
import { endUserSessions } from "#/auth/session.ts";
import { pickAvatarColor } from "#/auth/users.ts";
import { type ServerConfig, signsInLocally } from "#/config.ts";
import type { UpdateStatus } from "#/jobs/updateCheck.ts";
import { logger } from "#/lib/logger.ts";
import { hashPassword } from "#/lib/password.ts";
import { jobStatuses } from "#/lib/periodic.ts";
import { newTemporaryPassword } from "#/lib/temporaryPassword.ts";
import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import type { Mailer, MailStatus } from "#/mail/mailer.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { emailTaken, HttpError } from "#/middleware/error.ts";
import { deleteAccount } from "#/sharing/deleteAccount.ts";
import type { NoteEvents } from "#/sharing/noteEvents.ts";
import type { TeamShares } from "#/sharing/teamShares.ts";
import {
  type AdminGuardedResult,
  EmailTakenError,
  type StorageDriver,
  UsernameTakenError,
  type UserSummary,
} from "#/storage/types.ts";
import {
  adminCreateUserSchema,
  adminUpdateUserSchema,
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import { VERSION } from "#/version.ts";
import { registerAdminCheckRoutes } from "./adminChecks.ts";
import { registerAdminTeamRoutes } from "./teams.ts";

interface AdminDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  revocations: SessionRevocations;
  noteEvents: NoteEvents;
  teamShares: TeamShares;
  /** What the update check last found. */
  updateStatus?: (() => UpdateStatus | null) | undefined;
  /** The server's mailer and how it has gone; null without `SMTP_URL`. */
  mail?: (Mailer & { status(): MailStatus }) | null | undefined;
}

function toAdminUser(user: UserSummary): AdminUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    avatarColor: user.avatarColor,
    email: user.email,
    isAdmin: user.isAdmin,
    // The stored value is `oidc:<issuer>`; which issuer is not the admin
    // screen's business, and the wire type is the provider name.
    provider: user.provider === "local" ? "local" : "oidc",
    mustChangePassword: user.mustChangePassword,
    noteCount: user.noteCount,
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt,
  };
}

function refuseGuarded(result: AdminGuardedResult): void {
  if (result === "not-found") throw new HttpError(404, "User not found");
  if (result === "last-admin") {
    throw new HttpError(409, "The server must keep at least one admin");
  }
}

/**
 * `/api/admin`: account management for admins.
 *
 * Whether the caller is an admin is read from storage on every request
 * (`middleware/protect.ts`, from `auth: "admin"`) rather than carried in the
 * session, so revoking admin takes effect on the next
 * request and not whenever the session happens to end.
 *
 * An admin manages other people's accounts, never their own: removing your own
 * admin, deleting yourself or resetting your own password from here is
 * refused. Each is a way to lock yourself out mid-task, and each has a safer
 * route (another admin, or Change password).
 */
export function createAdminRoutes(deps: AdminDeps) {
  const admin = new Hono<{ Variables: { auth: AuthContext } }>();
  /** Where local accounts can sign in, and so an admin can create one or
   * give one a password. */
  function requireLocalProvider(): void {
    if (!signsInLocally(deps.cfg)) {
      throw new HttpError(404, "Accounts are managed by the identity provider");
    }
  }

  function refuseSelf(c: { get(key: "auth"): AuthContext }, id: string) {
    if (c.get("auth").userId === id) {
      throw new HttpError(409, "Admins cannot change their own account here");
    }
  }

  async function summaryOf(id: string): Promise<AdminUser> {
    const summary = await deps.storage.users.summarize(id);
    if (!summary) throw new HttpError(404, "User not found");
    return toAdminUser(summary);
  }

  admin.get("/users", async (c) => {
    const users = await deps.storage.users.list();
    const body: AdminUsersResponse = {
      users: users.map(toAdminUser),
    };
    return c.json(body);
  });

  admin.post(
    "/users",
    zValidator("json", adminCreateUserSchema, validatorHook),
    async (c) => {
      requireLocalProvider();
      const { username, email } = c.req.valid("json");
      if (await deps.storage.users.findByUsername(username)) {
        throw new HttpError(409, "Username is already taken");
      }
      if (email && (await deps.storage.users.findByEmail(email))) {
        throw emailTaken();
      }
      const temporaryPassword = newTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword, deps.cfg);
      let id: string;
      try {
        ({ id } = await deps.storage.users.create({
          id: newId(),
          username,
          displayName: username,
          avatarColor: pickAvatarColor(),
          email: email ?? null,
          provider: "local",
          externalId: null,
          passwordHash,
          mustChangePassword: true,
          createdAt: nowIso(),
        }));
      } catch (err) {
        // Lost a race with a sign-up of the same name after the check above.
        if (err instanceof UsernameTakenError) {
          throw new HttpError(409, "Username is already taken");
        }
        if (err instanceof EmailTakenError) throw emailTaken();
        throw err;
      }
      logger.info("Admin created an account", {
        adminId: c.get("auth").userId,
        userId: id,
      });
      audit(deps.storage, c, {
        action: "admin.user_created",
        actorId: c.get("auth").userId,
        targetId: id,
      });
      const body: AdminTemporaryPasswordResponse = {
        user: await summaryOf(id),
        temporaryPassword,
      };
      return c.json(body, 201);
    },
  );

  admin.put(
    "/users/:id",
    zValidator("json", adminUpdateUserSchema, validatorHook),
    async (c) => {
      const id = c.req.param("id") as string;
      refuseSelf(c, id);
      const { isAdmin, email } = c.req.valid("json");
      // The address first: it is the change that can be refused for a reason
      // the admin can fix, and a refusal should leave the rights untouched.
      if (email !== undefined) {
        const result = await deps.storage.users.setEmail(id, email);
        if (result === "not-found") throw new HttpError(404, "User not found");
        if (result === "email-taken") throw emailTaken();
        // A sign-in or reset link already sent went to the address this
        // replaces.
        await deps.storage.signInLinks.deleteByUser(id);
        await deps.storage.passwordResets.deleteByUser(id);
        logger.info("Admin changed an email address", {
          adminId: c.get("auth").userId,
          userId: id,
        });
        audit(deps.storage, c, {
          action: "admin.email_changed",
          actorId: c.get("auth").userId,
          targetId: id,
        });
      }
      if (isAdmin !== undefined) {
        refuseGuarded(await deps.storage.users.setAdmin(id, isAdmin));
        logger.info(isAdmin ? "Admin granted admin" : "Admin revoked admin", {
          adminId: c.get("auth").userId,
          userId: id,
        });
        audit(deps.storage, c, {
          action: isAdmin ? "admin.admin_granted" : "admin.admin_revoked",
          actorId: c.get("auth").userId,
          targetId: id,
        });
      }
      const body: AdminUserResponse = { user: await summaryOf(id) };
      return c.json(body);
    },
  );

  admin.post("/users/:id/password", async (c) => {
    requireLocalProvider();
    const id = c.req.param("id") as string;
    refuseSelf(c, id);
    const target = await deps.storage.users.findById(id);
    if (!target) throw new HttpError(404, "User not found");
    if (target.provider !== "local") {
      throw new HttpError(409, "This account signs in through single sign-on");
    }
    const temporaryPassword = newTemporaryPassword();
    await deps.storage.users.setPassword(
      id,
      await hashPassword(temporaryPassword, deps.cfg),
      true,
    );
    // A reset is often because someone else has the password, so whoever is
    // signed in with it now is signed out, sockets included. It is also how
    // someone who lost their authenticator and their recovery key gets back
    // in, so two-factor goes too, passkeys included; they can add them again.
    // It restores the sign-in and no key: the notes stay locked without one.
    await endUserSessions(deps.storage, deps.revocations, id);
    await deps.storage.twoFactor.disable(id);
    await deps.storage.passkeys.deleteByUser(id);
    logger.info("Admin reset a password", {
      adminId: c.get("auth").userId,
      userId: id,
    });
    audit(deps.storage, c, {
      action: "admin.password_reset",
      actorId: c.get("auth").userId,
      targetId: id,
    });
    const body: AdminTemporaryPasswordResponse = {
      user: await summaryOf(id),
      temporaryPassword,
    };
    return c.json(body);
  });

  admin.delete("/users/:id", async (c) => {
    const id = c.req.param("id") as string;
    refuseSelf(c, id);
    refuseGuarded(await deleteAccount(deps, id));
    logger.info("Admin deleted an account", {
      adminId: c.get("auth").userId,
      userId: id,
    });
    audit(deps.storage, c, {
      action: "admin.user_deleted",
      actorId: c.get("auth").userId,
      targetId: id,
    });
    return c.body(null, 204);
  });

  /** Whether a newer release is out, for the account menu to mention. */
  admin.get("/update", (c) => {
    const body: AdminUpdateResponse = {
      version: VERSION,
      update: deps.updateStatus?.() ?? null,
    };
    return c.json(body);
  });

  /** What the server holds, per account and in total, and how its
   * background jobs last ran. */
  admin.get("/overview", async (c) => {
    const stats = await deps.storage.maintenance.stats();
    const users = new Map(
      (await deps.storage.users.list()).map((u) => [u.id, u]),
    );
    const body: AdminOverviewResponse = {
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      totals: stats.totals,
      perUser: stats.perUser.flatMap((row) => {
        const user = users.get(row.userId);
        return user
          ? [
              {
                user: {
                  id: user.id,
                  username: user.username,
                  displayName: user.displayName || user.username,
                  avatarColor: user.avatarColor,
                },
                notes: row.notes,
                attachments: row.attachments,
                attachmentBytes: row.attachmentBytes,
              },
            ]
          : [];
      }),
      jobs: jobStatuses(),
      update: deps.updateStatus?.() ?? null,
    };
    return c.json(body);
  });

  /** The audit log, a page at a time; see `auditPage`. */
  admin.get("/audit", async (c) => {
    const body: AuditLogResponse = await auditPage(deps.storage, {
      limit: c.req.query("limit"),
      before: c.req.query("before"),
      userId: c.req.query("userId"),
      action: c.req.query("action"),
    });
    return c.json(body);
  });

  registerAdminTeamRoutes(admin, deps);
  registerAdminCheckRoutes(admin, deps);

  return admin;
}
