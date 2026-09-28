import { verifyPassword } from "../lib/password.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import type { LoginAttempts } from "./local/loginAttempts.js";

/** How recent a sign-in through an identity provider has to be to stand in
 * for a password the account does not have. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

/**
 * Proof that the person at the session is the account's owner, asked before
 * anything that would let whoever holds a stolen session keep the account or
 * its notes: an email address (through which a reset link takes the
 * password), an API token, a webhook, and the two-factor changes.
 * `sessionOnly` already keeps tokens away from these; this keeps a session
 * that is not the owner's away too.
 *
 * An account with a password confirms with it, counted against the same
 * per-name budget as signing in, so a stolen session cannot guess at it
 * faster than the sign-in form could. An account that signs in only through
 * an identity provider has nothing to type, so its proof is a sign-in within
 * `RECENT_SIGN_IN_MS`, which the client asks for with `prompt=login`.
 *
 * Throws with a code the client turns into its own words:
 * `confirmation_required` (no password sent), `password_incorrect`,
 * `reauthentication_required`; 429 while the name is locked.
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
