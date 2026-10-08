import type { PushKeyResponse } from "@manifesto/shared";
import { apiFetch, apiJson } from "../storage/apiRequest.js";
import { serverFeature } from "./serverFeatures.js";

/**
 * This browser's push subscription for the signed-in account, in connected
 * mode: what lets the server send a reminder while the app is closed (spec:
 * `docs/specification/features/reminders.md`, "Push from the server").
 *
 * Nothing here asks for permission. A browser may subscribe only once
 * notifications are allowed, which the reminder picker asks for when the
 * first reminder is saved; this runs after that, and at each start for a
 * browser that already allowed them. Neither function rejects.
 */

interface PushRegistration {
  pushManager?: PushManager;
}

/** How long to wait for the service worker at start before giving up. */
const WORKER_WAIT_MS = 10_000;

/**
 * The push manager of this app's service worker, or null where there is
 * none. `wait` is for the start of the app, when the worker may still be
 * installing; without it the answer is what is registered right now, which
 * is what signing out needs: `serviceWorker.ready` never settles in a
 * browser where no worker was ever registered, and sign-out would wait on it
 * for good.
 */
async function pushManager(wait: boolean): Promise<PushManager | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  if (typeof Notification === "undefined") return null;
  const registration: PushRegistration | undefined = wait
    ? await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<undefined>((resolve) =>
          setTimeout(() => resolve(undefined), WORKER_WAIT_MS),
        ),
      ])
    : await navigator.serviceWorker.getRegistration();
  return registration?.pushManager ?? null;
}

/** The server's key as `subscribe` takes it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameKey(held: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!held) return false;
  const bytes = new Uint8Array(held);
  return (
    bytes.length === wanted.length && bytes.every((b, i) => b === wanted[i])
  );
}

/**
 * Subscribes this browser to the account's reminders and tells the server,
 * where that is possible: the server has push on, the browser has a push
 * manager, and notifications are allowed. Run again, it sends the same
 * subscription, which is how a new sign-in in the same browser takes it over.
 * Says whether the server holds a subscription for this browser afterwards.
 */
export async function ensurePushSubscription(): Promise<boolean> {
  try {
    if (!serverFeature("pushReminders")) return false;
    // Before the worker is waited for: most browsers never allowed them.
    if (typeof Notification === "undefined") return false;
    if (Notification.permission !== "granted") return false;
    const manager = await pushManager(true);
    if (!manager) return false;

    const { publicKey } =
      (await apiJson<PushKeyResponse>("GET", "/push/key")) ?? {};
    if (!publicKey) return false;
    const key = keyBytes(publicKey);

    let subscription = await manager.getSubscription();
    // Made for another server, or for this one before its key changed: the
    // push service would refuse this server's messages for it.
    if (
      subscription &&
      !sameKey(subscription.options.applicationServerKey, key)
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await manager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });

    const { endpoint, keys } = subscription.toJSON();
    if (!endpoint || !keys?.p256dh || !keys.auth) return false;
    await apiJson("POST", "/push/subscriptions", {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
    return true;
  } catch (err) {
    // Reminders still fire while the app is open; this only adds to that.
    console.warn("Push subscription failed:", err);
    return false;
  }
}

/**
 * Takes this browser's subscription away from the account, before signing
 * out: the server forgets it, and the browser gives it up, so the next
 * account to sign in here starts with its own.
 */
export async function removePushSubscription(): Promise<void> {
  try {
    const manager = await pushManager(false);
    const subscription = await manager?.getSubscription();
    if (!subscription) return;
    await apiFetch("DELETE", "/push/subscriptions", {
      endpoint: subscription.endpoint,
    });
    await subscription.unsubscribe();
  } catch (err) {
    // The server drops it with the session anyway.
    console.warn("Removing the push subscription failed:", err);
  }
}
