import { createExpiringCounter } from "#/lib/expiringCounter.ts";

/**
 * The failed sign-ins that one name can collect before the server stops to ask.
 */
export const MAX_LOGIN_FAILURES = 10;
/**
 * How long the server remembers failures. Thus, how long a locked name waits.
 */
const WINDOW_MS = 15 * 60 * 1000;
/**
 * The number of names tracked at the same time. It is much more than the
 * signed-in users of a real server, and small enough that the map cannot become
 * the attack.
 */
const MAX_NAMES = 50_000;

export interface LoginAttempts {
  /** The seconds that this name must wait, or 0 when it can try. */
  retryAfter(username: string): number;
  /** Record a sign-in that did not make a session. */
  fail(username: string): void;
  /** Record the correct password, which clears all previous failures. */
  succeed(username: string): void;
}

/**
 * A budget of failed sign-ins, counted for each account name.
 *
 * The throttle for each IP in `middleware/rateLimit.ts` cannot protect a named
 * account. An attacker with many addresses gets a new budget with each address.
 * The name to guess is rarely a secret, because `auth/initialAdmin.ts` creates
 * `admin` on each local-auth server. When the count uses the submitted name,
 * the guesses add up, however they arrive.
 *
 * The key is the submitted name, not a user id. Thus, the server counts a name
 * that no account has in exactly the same way as a name that exists. A counter
 * that existed only for real accounts would answer the question that the
 * handler carefully does not answer: if the account exists.
 *
 * The lock is a wait, not a latch. It ends with the window, and the correct
 * password clears it. Thus, a person who guesses at a name can only cost it
 * fifteen minutes. All lockouts make this trade. The alternative, a latch that
 * an admin must release, changes the same guesses into a permanent denial of
 * service.
 *
 * It is in the process, as the rate limiter, for the same reason. With more
 * than one node, each node keeps its own count until this moves to shared
 * storage.
 */
export function createLoginAttempts(): LoginAttempts {
  const failures = createExpiringCounter({
    windowMs: WINDOW_MS,
    maxEntries: MAX_NAMES,
  });
  // The server finds accounts without regard to case (`findByUsername` collates
  // in that way). Thus, the count must do the same. If not, `Admin` and `admin`
  // would each get a budget to guess the same account.
  const keyFor = (username: string) => username.trim().toLowerCase();
  return {
    retryAfter(username) {
      const now = Date.now();
      const window = failures.peek(keyFor(username), now);
      if (!window || window.count < MAX_LOGIN_FAILURES) return 0;
      return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    },
    fail(username) {
      failures.hit(keyFor(username));
    },
    succeed(username) {
      failures.clear(keyFor(username));
    },
  };
}
