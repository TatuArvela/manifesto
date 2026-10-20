import type { PushKeyResponse } from "@manifesto/shared";
import { apiFetch, apiJson } from "#/storage/apiRequest.ts";
import { serverFeature } from "./serverFeatures.ts";

/**
 * The push subscription of this browser for the signed-in account, in connected
 * mode. It lets the server send a reminder while the app is closed (spec:
 * `docs/specification/features/reminders.md`, "Push from the server").
 *
 * Nothing here asks for permission. A browser can subscribe only after
 * notifications are permitted, which the reminder picker asks for when the
 * first reminder is saved. This runs after that, and at each start for a
 * browser that already permitted them. Neither function rejects.
 */

interface PushRegistration {
  pushManager?: PushManager;
}

/** How long to wait for the service worker at start before the code stops. */
const WORKER_WAIT_MS = 10_000;

/**
 * The push manager of the service worker of this app, or null where there is
 * none. `wait` is for the start of the app, when the worker can still be in its
 * installation. Without it, the answer is what is registered at this moment,
 * which a sign-out needs. `serviceWorker.ready` never settles in a browser
 * where no worker was ever registered, and the sign-out would wait for it
 * forever.
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

/** The key of the server as `subscribe` takes it. */
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
 * Subscribes this browser to the reminders of the account and tells the server,
 * where that is possible: the server has push on, the browser has a push
 * manager, and notifications are permitted. When it runs again, it sends the
 * same subscription. Thus, a new sign-in in the same browser takes it over.
 * Tells if the server has a subscription for this browser after that.
 */
export async function ensurePushSubscription(): Promise<boolean> {
  try {
    if (!serverFeature("pushReminders")) return false;
    // Before the wait for the worker. Most browsers never permitted them.
    if (typeof Notification === "undefined") return false;
    if (Notification.permission !== "granted") return false;
    const manager = await pushManager(true);
    if (!manager) return false;

    const { publicKey } =
      (await apiJson<PushKeyResponse>("GET", "/push/key")) ?? {};
    if (!publicKey) return false;
    const key = keyBytes(publicKey);

    let subscription = await manager.getSubscription();
    // Made for a different server, or for this server before its key changed.
    // The push service would refuse the messages of this server for it.
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
    // Reminders still fire while the app is open. This only adds to that.
    console.warn("Push subscription failed:", err);
    return false;
  }
}

/**
 * Removes the subscription of this browser from the account, before the
 * sign-out. The server forgets it, and the browser releases it. Thus, the next
 * account that signs in here starts with its own.
 */
/**
 * Unsubscribe this browser without a message to the server, for when the
 * account for which it was subscribed is gone, and took the row of the server
 * with it.
 */
export async function dropBrowserPushSubscription(): Promise<void> {
  try {
    const manager = await pushManager(false);
    await (await manager?.getSubscription())?.unsubscribe();
  } catch (err) {
    console.warn("Removing the push subscription failed:", err);
  }
}

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
