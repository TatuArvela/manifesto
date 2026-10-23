import { zValidator } from "@hono/zod-validator";
import type {
  DeviceSignInRequestResponse,
  DeviceSignInStartedResponse,
  DeviceSignInWaitResponse,
} from "@manifesto/shared";
import type { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import type { ServerConfig } from "#/config.ts";
import { nowIso } from "#/lib/time.ts";
import { hashToken, newSessionToken } from "#/lib/token.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import {
  deviceSignInApproveSchema,
  deviceSignInInspectSchema,
  deviceSignInWaitSchema,
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import { requireConfirmation } from "./confirmation.ts";
import type { LoginAttempts } from "./local/loginAttempts.ts";
import { issueSession } from "./session.ts";
import { toAuthUser } from "./users.ts";

/** How long a request waits for an approval, and then for its collection. */
export const DEVICE_SIGN_IN_MINUTES = 3;

/** The part of the `User-Agent` that the approving person reads. */
const USER_AGENT_MAX = 200;

const gone = () =>
  new HttpError(410, "This request has expired or was used already");

/**
 * `/api/v1/auth/device-sign-in`: a new device signs in by a QR code that it
 * shows, and that a device already signed in approves.
 *
 * - The new device starts a request with no session. It gets an id, which goes
 *   into the code, and a wait token, which stays on the device. Only the wait
 *   token collects the session. Thus, a person who sees the code cannot.
 * - The approving device reads the request (`inspect`), and approves it with
 *   `requireConfirmation`, because a stolen session must not make a session of
 *   its own. The approval can carry the secret key of the account, wrapped to a
 *   key that only the new device holds (`shared/src/crypto/deviceSeal.ts`).
 * - The new device asks (`wait`) until the approval is there. "Not me" on the
 *   approving device ends the request (`deny`), and the log records it.
 *
 * The approval asks for no second factor. The approving session already passed
 * it, and its person confirms again with the password. The routes are the same
 * for both providers. An account of single sign-on confirms with a recent
 * sign-in.
 */
export function registerDeviceSignInRoutes(
  router: Hono<{ Variables: { auth: AuthContext } }>,
  deps: {
    storage: StorageDriver;
    cfg: ServerConfig;
    loginAttempts: LoginAttempts;
  },
) {
  const { storage } = deps;

  router.post("/device-sign-in", async (c) => {
    const id = newSessionToken();
    const waitToken = newSessionToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + DEVICE_SIGN_IN_MINUTES * 60_000,
    ).toISOString();
    await storage.deviceSignIns.create({
      idHash: hashToken(id),
      waitHash: hashToken(waitToken),
      userAgent: (c.req.header("user-agent") ?? "").slice(0, USER_AGENT_MAX),
      createdAt: now.toISOString(),
      expiresAt,
    });
    const body: DeviceSignInStartedResponse = { id, waitToken, expiresAt };
    return c.json(body, 200);
  });

  router.post(
    "/device-sign-in/inspect",
    zValidator("json", deviceSignInInspectSchema, validatorHook),
    async (c) => {
      const { id } = c.req.valid("json");
      const found = await storage.deviceSignIns.find(hashToken(id), nowIso());
      if (!found) throw gone();
      const body: DeviceSignInRequestResponse = found;
      return c.json(body, 200);
    },
  );

  router.post(
    "/device-sign-in/approve",
    zValidator("json", deviceSignInApproveSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      const { id, key, password } = c.req.valid("json");
      await requireConfirmation(deps, auth, password);
      const approved = await storage.deviceSignIns.approve(
        hashToken(id),
        auth.userId,
        key ?? null,
        nowIso(),
      );
      if (!approved) throw gone();
      audit(storage, c, {
        action: "auth.device_sign_in_approved",
        actorId: auth.userId,
        ...(key && { detail: { secretKey: "yes" } }),
      });
      return c.body(null, 204);
    },
  );

  // "Not me" on the approving device. The request ends, and the log of the
  // account keeps the refusal. Thus, a person who was sent a code by somebody
  // else finds it again on the Activity page.
  router.post(
    "/device-sign-in/deny",
    zValidator("json", deviceSignInInspectSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      const { id } = c.req.valid("json");
      if (!(await storage.deviceSignIns.deny(hashToken(id), nowIso()))) {
        throw gone();
      }
      audit(storage, c, {
        action: "auth.device_sign_in_denied",
        actorId: auth.userId,
      });
      return c.body(null, 204);
    },
  );

  router.post(
    "/device-sign-in/wait",
    zValidator("json", deviceSignInWaitSchema, validatorHook),
    async (c) => {
      const { waitToken } = c.req.valid("json");
      const claimed = await storage.deviceSignIns.claim(
        hashToken(waitToken),
        nowIso(),
      );
      if (claimed === "pending") {
        const body: DeviceSignInWaitResponse = { pending: true };
        return c.json(body, 202);
      }
      const user = claimed && (await storage.users.findById(claimed.userId));
      if (!claimed || !user) throw gone();
      const session = await issueSession(storage, deps.cfg, user.id);
      audit(storage, c, {
        action: "auth.signed_in",
        actorId: user.id,
        detail: { method: "device" },
      });
      const body: DeviceSignInWaitResponse = {
        token: session.token,
        user: toAuthUser(user),
        key: claimed.key,
      };
      return c.json(body, 200);
    },
  );
}
