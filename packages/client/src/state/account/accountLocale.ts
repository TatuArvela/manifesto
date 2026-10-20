import { effect, untracked } from "@preact/signals";
import { locale } from "#/state/prefs.ts";
import { apiFetch } from "#/storage/apiRequest.ts";
import { storageConnection } from "#/storage/index.ts";
import { currentUser } from "./auth.ts";

let reportingLocale: string | null = null;
let stop: (() => void) | null = null;

/**
 * The server writes the mail that the action of a different account sends to
 * this account (a share invitation) in the language that it keeps for the
 * account. Thus, the client tells it the language of the app each time the two
 * are different: on the first start against a server that keeps one, and after
 * the user changes it. The client does not ask a server that does not keep one,
 * which leaves `locale` absent. `App` starts it one time.
 */
export function startAccountLocaleReport(): () => void {
  stop ??= effect(() => {
    // The connection, not `authToken`. `apiFetch` sends what it has, and an
    // effect of its own writes it from the token.
    const { serverUrl, token } = storageConnection.value;
    const user = currentUser.value;
    const wanted = locale.value;
    if (serverUrl === null || !token || !user) return;
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
  // Offline, the next start reports it again.
  const res = await apiFetch("PUT", "/auth/me/locale", { locale: wanted });
  const user = currentUser.value;
  if (res?.ok && storageConnection.value.token === token && user) {
    currentUser.value = { ...user, locale: wanted };
  }
  if (reportingLocale === wanted) reportingLocale = null;
}
