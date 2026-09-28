import { effect, untracked } from "@preact/signals";
import { apiFetch } from "../storage/apiRequest.js";
import { storageConnection } from "../storage/index.js";
import { currentUser } from "./auth.js";
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
    // The connection, not `authToken`: `apiFetch` sends what it holds, and
    // it is written from the token by an effect of its own.
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
