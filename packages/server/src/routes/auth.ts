import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import type { SessionsRepo } from "../db/repositories/sessions.js";
import {
  type PublicUser,
  publicUserFromRow,
  type UsersRepo,
} from "../db/repositories/users.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { newSessionToken } from "../lib/token.js";
import { newId } from "../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { authCredentialsSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

interface AuthDeps {
  usersRepo: UsersRepo;
  sessionsRepo: SessionsRepo;
  cfg: ServerConfig;
}

const AVATAR_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function pickAvatarColor(): string {
  return AVATAR_COLORS[
    Math.floor(Math.random() * AVATAR_COLORS.length)
  ] as string;
}

interface AuthSuccess {
  token: string;
  user: PublicUser;
}

async function issueSession(
  deps: AuthDeps,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = newSessionToken();
  const now = nowIso();
  const expiresAt = isoPlusDays(deps.cfg.sessionTtlDays);
  await deps.sessionsRepo.create({
    token,
    userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });
  return { token, expiresAt };
}

export function createAuthRoutes(deps: AuthDeps) {
  const auth = new Hono<{ Variables: { auth: AuthContext } }>();

  // Tight per-IP throttling on the unauthenticated endpoints — slows down
  // password-spraying attacks. Tests can override the window by mounting
  // these routes after stubbing the limiter, but the production defaults
  // are 10 requests / 15 minutes per IP.
  const authThrottle = rateLimit({ limit: 10, windowMs: 15 * 60 * 1000 });

  auth.post(
    "/register",
    authThrottle,
    zValidator("json", authCredentialsSchema, validatorHook),
    async (c) => {
      const { username, password } = c.req.valid("json");
      const existing = await deps.usersRepo.findByUsername(username);
      if (existing) {
        throw new HttpError(409, "Username is already taken");
      }
      const passwordHash = await hashPassword(password, deps.cfg);
      const user = await deps.usersRepo.create({
        id: newId(),
        username,
        passwordHash,
        displayName: username,
        avatarColor: pickAvatarColor(),
        createdAt: nowIso(),
      });
      const { token } = await issueSession(deps, user.id);
      const body: AuthSuccess = { token, user: publicUserFromRow(user) };
      return c.json(body, 201);
    },
  );

  auth.post(
    "/login",
    authThrottle,
    zValidator("json", authCredentialsSchema, validatorHook),
    async (c) => {
      const { username, password } = c.req.valid("json");
      const user = await deps.usersRepo.findByUsername(username);
      if (!user) {
        throw new HttpError(401, "Invalid username or password");
      }
      const ok = await verifyPassword(user.password_hash, password);
      if (!ok) {
        throw new HttpError(401, "Invalid username or password");
      }
      const { token } = await issueSession(deps, user.id);
      const body: AuthSuccess = { token, user: publicUserFromRow(user) };
      return c.json(body, 200);
    },
  );

  auth.post(
    "/logout",
    createAuthMiddleware(deps.sessionsRepo, deps.cfg),
    async (c) => {
      const { token } = c.get("auth");
      await deps.sessionsRepo.deleteByToken(token);
      return c.body(null, 204);
    },
  );

  return auth;
}
