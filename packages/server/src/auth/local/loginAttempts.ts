import { createExpiringCounter } from "../../lib/expiringCounter.js";

/** Failed sign-ins one name may collect before it stops being asked. */
export const MAX_LOGIN_FAILURES = 10;
/** How long failures are remembered, and so how long a locked name waits. */
const WINDOW_MS = 15 * 60 * 1000;
/** Names tracked at once. Far above any real server's signed-in population,
 * and small enough that the map cannot become the attack. */
const MAX_NAMES = 50_000;

export interface LoginAttempts {
  /** Seconds this name must wait, or 0 when it may be tried. */
  retryAfter(username: string): number;
  /** Record a sign-in that did not produce a session. */
  fail(username: string): void;
  /** Record the right password, which forgives everything before it. */
  succeed(username: string): void;
}

/**
 * A budget of failed sign-ins, counted per account name.
 *
 * The per-IP throttle in `middleware/rateLimit.ts` cannot defend a named
 * account: an attacker with addresses to spare collects a fresh budget with
 * every one of them, and the name worth guessing is rarely a secret, since
 * `auth/initialAdmin.ts` creates `admin` on every local-auth server. Counting
 * against the submitted name instead makes the guesses add up however they
 * arrive.
 *
 * Keyed on the name that was submitted rather than on a user id, so a name
 * nobody holds is counted exactly like one that exists. A counter that only
 * existed for real accounts would answer the question the handler is careful
 * not to: whether the account is there.
 *
 * The lock is a wait and not a latch. It lapses with the window, and the
 * right password clears it, so the worst anyone can do by guessing at a name
 * is cost it fifteen minutes. That is the trade every lockout makes, and the
 * alternative, a latch an admin has to release, turns the same guessing into
 * a standing denial of service.
 *
 * In-process, like the rate limiter and for the same reason: across more than
 * one node each holds its own count until this moves to shared storage.
 */
export function createLoginAttempts(): LoginAttempts {
  const failures = createExpiringCounter({
    windowMs: WINDOW_MS,
    maxEntries: MAX_NAMES,
  });
  // Accounts are found case-insensitively (`findByUsername` collates that
  // way), so the count has to be too, or `Admin` and `admin` would each get a
  // budget for guessing at the one account.
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
