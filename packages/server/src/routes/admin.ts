import { zValidator } from "@hono/zod-validator";
import type {
  AdminTemporaryPasswordResponse,
  AdminUser,
  AdminUserResponse,
  AdminUsersResponse,
} from "@manifesto/shared";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SessionRevocations } from "../auth/revocations.js";
import { endUserSessions } from "../auth/session.js";
import type { AuthProvider } from "../auth/types.js";
import { pickAvatarColor } from "../auth/users.js";
import type { ServerConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import { newTemporaryPassword } from "../lib/temporaryPassword.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { emailTaken, HttpError } from "../middleware/error.js";
import type { NoteEvents } from "../sharing/noteEvents.js";
import {
  type AdminGuardedResult,
  EmailTakenError,
  type StorageDriver,
  UsernameTakenError,
  type UserSummary,
} from "../storage/types.js";
import {
  adminCreateUserSchema,
  adminUpdateUserSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

interface AdminDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  revocations: SessionRevocations;
  noteEvents: NoteEvents;
  /** The shared per-user limiter, mounted after auth. */
  rateLimit?: MiddlewareHandler;
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
 * Whether the caller is an admin is read from storage on every request rather
 * than carried in the session, so revoking admin takes effect on the next
 * request and not whenever the session happens to end.
 *
 * An admin manages other people's accounts, never their own: removing your own
 * admin, deleting yourself or resetting your own password from here is
 * refused. Each is a way to lock yourself out mid-task, and each has a safer
 * route (another admin, or Change password).
 */
export function createAdminRoutes(deps: AdminDeps) {
  const admin = new Hono<{ Variables: { auth: AuthContext } }>();
  admin.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) admin.use("*", deps.rateLimit);
  admin.use("*", async (c, next) => {
    const caller = await deps.storage.users.findById(c.get("auth").userId);
    if (!caller?.isAdmin) {
      throw new HttpError(403, "Admin access required");
    }
    await next();
  });

  /** Where local accounts are the only kind that exists, and so the only kind
   * an admin can create or give a password to. */
  function requireLocalProvider(): void {
    if (deps.cfg.authProvider !== "local") {
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
    const body: AdminUsersResponse = { users: users.map(toAdminUser) };
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
        logger.info("Admin changed an email address", {
          adminId: c.get("auth").userId,
          userId: id,
        });
      }
      if (isAdmin !== undefined) {
        refuseGuarded(await deps.storage.users.setAdmin(id, isAdmin));
        logger.info(isAdmin ? "Admin granted admin" : "Admin revoked admin", {
          adminId: c.get("auth").userId,
          userId: id,
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
    // signed in with it now is signed out, sockets included.
    await endUserSessions(deps.storage, deps.revocations, id);
    logger.info("Admin reset a password", {
      adminId: c.get("auth").userId,
      userId: id,
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
    // Read before the delete: the shares go with the account by cascade,
    // and the people on the other end of them still have to hear about it.
    const onTheirNotes = await deps.storage.shares.listByOwner(id);
    const onOthersNotes = await deps.storage.shares.listByRecipient(id);
    refuseGuarded(await deps.storage.users.delete(id));
    // The rows went with the user by cascade; what is left to end is any
    // socket still open on one of them.
    deps.revocations.revoke({ userId: id });
    deps.noteEvents.ended(onTheirNotes);
    for (const noteId of new Set(onOthersNotes.map((s) => s.noteId))) {
      await deps.noteEvents.changed(noteId);
    }
    logger.info("Admin deleted an account", {
      adminId: c.get("auth").userId,
      userId: id,
    });
    return c.body(null, 204);
  });

  return admin;
}
