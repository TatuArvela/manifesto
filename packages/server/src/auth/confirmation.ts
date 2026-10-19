import { verifyPassword } from "#/lib/password.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import type { LoginAttempts } from "./local/loginAttempts.ts";

/**
 * How recent a sign-in through an identity provider must be to replace a
 * password that the account does not have.
 */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

/**
 * Proof that the person at the session is the owner of the account. The server
 * asks for it before each action that would let the holder of a stolen session
 * keep the account or its notes: an email address (a reset link to it takes the
 * password), an API token, a webhook, and the two-factor changes. `sessionOnly`
 * already keeps tokens away from these. This also keeps away a session that
 * does not belong to the owner.
 *
 * An account with a password confirms with it. It counts against the same
 * budget for each name as a sign-in. Thus, a stolen session cannot guess it
 * faster than the sign-in form could. An account that signs in only through an
 * identity provider has nothing to type. Thus, its proof is a sign-in within
 * `RECENT_SIGN_IN_MS`, which the client asks for with `prompt=login`.
 *
 * Throws with a code that the client changes into its own words:
 * `confirmation_required` (no password sent), `password_incorrect`,
 * `reauthentication_required`. 429 while the name is locked.
 */
export async function requireConfirmation(
  deps: { storage: StorageDriver; loginAttempts: LoginAttempts },
  auth: AuthContext,
  password: string | undefined,
): Promise<void> {
  const user = await deps.storage.users.findById(auth.userId);
  if (!user) throw new HttpError(401, "User not found");

  if (user.passwordHash) {
    if (!password) {
      throw new HttpError(
        403,
        "Confirm this with your password",
        "confirmation_required",
      );
    }
    if (deps.loginAttempts.retryAfter(user.username) > 0) {
      throw new HttpError(429, "Too many wrong passwords; try again later");
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      deps.loginAttempts.fail(user.username);
      throw new HttpError(
        403,
        "The password is not right",
        "password_incorrect",
      );
    }
    deps.loginAttempts.succeed(user.username);
    return;
  }

  const signedIn = auth.signedInAt ? Date.parse(auth.signedInAt) : Number.NaN;
  if (!(signedIn > Date.now() - RECENT_SIGN_IN_MS)) {
    throw new HttpError(
      403,
      "Sign in again to do this",
      "reauthentication_required",
    );
  }
}
