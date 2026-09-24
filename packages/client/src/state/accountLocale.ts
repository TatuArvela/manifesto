import { effect, untracked } from "@preact/signals";
import { authToken, currentUser, SERVER_URL } from "./auth.js";
import { locale } from "./prefs.js";

let reportingLocale: string | null = null;
let stop: (() => void) | null = null;

/**
 * The server writes mail another account's action sends this one (a share
 * invitation) in the language it holds for the account, so the client tells
 * it the one the app is in whenever the two differ: on the first start
 * against a server that keeps one, and after the user changes it. A server
 * that does not keep one leaves `locale` absent and is not asked. Started
 * once, by `App`.
 */
export function startAccountLocaleReport(): () => void {
  stop ??= effect(() => {
    const token = authToken.value;
    const user = currentUser.value;
    const wanted = locale.value;
    if (SERVER_URL === null || !token || !user) return;
    if (user.locale === undefined || user.locale === wanted) return;
    if (reportingLocale === wanted) return;
    reportingLocale = wanted;
    untracked(() => void reportLocale(token, wanted));
  });
  return () => {
    stop?.();
    stop = null;
  };
}

async function reportLocale(token: string, wanted: string): Promise<void> {
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/me/locale`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ locale: wanted }),
    });
    const user = currentUser.value;
    if (res.ok && authToken.value === token && user) {
      currentUser.value = { ...user, locale: wanted };
    }
  } catch {
    // offline: the next start reports it again
  } finally {
    if (reportingLocale === wanted) reportingLocale = null;
  }
}
