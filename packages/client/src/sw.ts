/// <reference lib="webworker" />
import { MAX_IMAGES_PER_NOTE } from "@manifesto/shared";
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import {
  SHARE_CACHE,
  SHARE_IMAGE_KEY_PREFIX,
  SHARE_TARGET_ACTION,
  SHARE_TARGET_PARAM,
  SHARE_TEXT_KEY,
  sharedTextFromForm,
} from "./shareTarget.ts";
import { loadDeviceKeys } from "./storage/deviceKeys.ts";
import { afterPush, readReminderPush, wordedPush } from "./swPush.ts";
import {
  afterFiring,
  isValidStoredReminder,
  POLL_INTERVAL_MS,
  type StoredReminder,
  stepFor,
} from "./swReminders.ts";

declare const self: ServiceWorkerGlobalScope & {
  registration: ServiceWorkerRegistration & {
    periodicSync?: {
      register: (
        tag: string,
        options: { minInterval: number },
      ) => Promise<void>;
      getTags?: () => Promise<string[]>;
    };
  };
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// "Share to..." posts here (the `share_target` of the manifest). Registered
// before the routes of Workbox. Thus, the POST comes to us. The navigation
// route of Workbox only answers GETs anyway. The shared text and images wait in
// a cache for the page that the redirect opens, because the code cannot give a
// POST body to it directly.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "POST" ||
    url.href.split("?")[0] !==
      new URL(SHARE_TARGET_ACTION, self.registration.scope).href
  ) {
    return;
  }
  event.respondWith(receiveShare(event.request));
});

async function receiveShare(request: Request): Promise<Response> {
  const scope = self.registration.scope;
  try {
    const form = await request.formData();
    // One share at a time. A second share before the page took the first
    // replaces it.
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      new URL(SHARE_TEXT_KEY, scope).href,
      Response.json(sharedTextFromForm(form)),
    );
    const images = form
      .getAll("images")
      .filter(
        (f): f is File => f instanceof File && f.type.startsWith("image/"),
      )
      .slice(0, MAX_IMAGES_PER_NOTE);
    await Promise.all(
      images.map((file, i) =>
        cache.put(
          new URL(`${SHARE_IMAGE_KEY_PREFIX}${i}`, scope).href,
          new Response(file, {
            headers: {
              "Content-Type": file.type,
              "X-File-Name": encodeURIComponent(file.name),
            },
          }),
        ),
      ),
    );
  } catch {
    // An unreadable share: the app still opens, with nothing to fill in.
  }
  return Response.redirect(`${scope}?${SHARE_TARGET_PARAM}`, 303);
}

// Under `pnpm dev`, the manifest is only `index.html`, with no revision. Thus,
// Workbox would cache the first copy that it loaded and serve it forever: a CSP
// or meta tag from an earlier run (a different `VITE_MANIFESTO_SERVER`, or
// none) against new scripts, until a hard reload went around the worker. The
// dev server answers each route itself. Thus, in dev, navigations go to it.
if (!import.meta.env.DEV) {
  precacheAndRoute(self.__WB_MANIFEST);
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL("index.html"), {
      denylist: [/^\/api\/v1\//, /\.[^/]+$/],
    }),
  );
}

// The header logo and the favicon, cached so that they still show offline. They
// are not precached as the remaining shell is. An instance rebrands when it
// replaces them in place (docs/specification/custom-instances.md). A precache
// entry is bound to the file as built. Thus, a replaced logo would never reach
// a user who comes back. Stale-while-revalidate serves the copy that it has,
// and gets a replacement on the next online visit.
const BRAND_MARKS = new Set(
  ["logo.svg", "favicon.svg"].map(
    (name) => new URL(name, self.registration.scope).href,
  ),
);
registerRoute(
  ({ url }) => BRAND_MARKS.has(url.origin + url.pathname),
  new StaleWhileRevalidate({ cacheName: "brand-marks" }),
);

const DB_NAME = "manifesto-reminders";
const STORE = "reminders";
const PERIODIC_TAG = "check-reminders";

// --- IndexedDB helpers ---

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "noteId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(): Promise<StoredReminder[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredReminder[]);
    req.onerror = () => reject(req.error);
  });
}

async function replaceAll(items: StoredReminder[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putOne(item: StoredReminder): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteOne(noteId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(noteId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Firing ---

async function fireDue(): Promise<void> {
  const items = await getAll();
  const now = Date.now();
  for (const item of items) {
    const step = stepFor(item, now);
    if (step.kind === "skip") await putOne(step.next);
    if (step.kind !== "fire") continue;
    try {
      await self.registration.showNotification(item.title, {
        body: item.body,
        tag: item.noteId,
        data: { noteId: item.noteId },
      });
    } catch {
      // The browser can reject if permission is not really given. Skip
      // silently.
      continue;
    }
    const { stored, nextTime } = afterFiring(item, new Date().toISOString());
    await putOne(stored);
    broadcast({ type: "reminder-fired", noteId: item.noteId, nextTime });
  }
}

function broadcast(message: unknown): void {
  self.clients.matchAll({ type: "window" }).then((clients) => {
    for (const client of clients) client.postMessage(message);
  });
}

// --- Polling fallback ---

let pollHandle: ReturnType<typeof setTimeout> | null = null;

function schedulePoll(): void {
  if (pollHandle) clearTimeout(pollHandle);
  pollHandle = setTimeout(async () => {
    await fireDue();
    schedulePoll();
  }, POLL_INTERVAL_MS);
}

// --- Lifecycle ---

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      try {
        const reg = self.registration;
        if (reg.periodicSync) {
          await reg.periodicSync.register(PERIODIC_TAG, {
            minInterval: 15 * 60_000,
          });
        }
      } catch {
        // periodicSync can be not available or refused. Thus, use polling.
      }
      await fireDue();
      schedulePoll();
    })(),
  );
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  // A service worker only gets `message` from the same-origin clients that it
  // controls. Thus, there is no sender to check here. The risk is the payload.
  // This handler runs with privileges, and `replaceAll` erases the full
  // reminder store. Thus, the code checks each field before it believes it.
  const data = event.data as
    | { type: "sync-reminders"; reminders: unknown }
    | { type: "delete-reminder"; noteId: unknown }
    | undefined;
  if (!data || typeof data !== "object") return;
  if (data.type === "sync-reminders") {
    if (!Array.isArray(data.reminders)) return;
    const valid = data.reminders.filter(isValidStoredReminder);
    if (valid.length !== data.reminders.length) {
      console.warn(
        `Ignoring ${data.reminders.length - valid.length} malformed reminder(s)`,
      );
    }
    event.waitUntil(replaceAll(valid).then(() => fireDue()));
  } else if (data.type === "delete-reminder") {
    if (typeof data.noteId !== "string" || !data.noteId) return;
    event.waitUntil(deleteOne(data.noteId));
  }
});

self.addEventListener(
  "periodicsync" as keyof ServiceWorkerGlobalScopeEventMap,
  ((
    event: Event & { tag?: string; waitUntil?: (p: Promise<unknown>) => void },
  ) => {
    if (event.tag === PERIODIC_TAG && event.waitUntil) {
      event.waitUntil(fireDue());
    }
  }) as EventListener,
);

// A reminder that the server fired, because no page of this account was open
// (`jobs/pushReminders.ts` on the server). Show it, and move the own copy of
// the reminder of this worker to where the server moved it. Thus, the next look
// at the list does not fire the same occurrence again. The server already wrote
// the change to the note. Thus, nothing is reported to a page.
self.addEventListener("push", (event) => {
  let payload: unknown = null;
  try {
    payload = event.data?.json() ?? null;
  } catch {
    // Not JSON: handled as an unreadable message below.
  }
  event.waitUntil(receivePush(payload));
});

async function receivePush(payload: unknown): Promise<void> {
  const push = readReminderPush(payload);
  if (!push) {
    // A push must show something. If not, the browser shows its own notice, and
    // can withdraw the subscription. Nothing that this server sends ends here.
    await self.registration.showNotification(await installedName());
    return;
  }
  // Opened here, with the account key that this device keeps while signed in.
  // The server sent the title and text sealed, and cannot read them.
  const worded = await wordedPush(push, await loadDeviceKeys());
  await self.registration.showNotification(worded.title, {
    body: worded.body,
    tag: push.noteId,
    data: { noteId: push.noteId },
  });
  try {
    const held = (await getAll()).find((item) => item.noteId === push.noteId);
    if (held) await putOne(afterPush(held, push));
  } catch {
    // The list is only a convenience here. The notification is already up.
  }
}

/**
 * The name of the app where it is installed, for a notification with nothing
 * else to say. It is the `name` of the manifest, which follows a rebrand by
 * both routes (`config.ts`; a worker has no document from which to read the
 * meta tag), and needs no catalogue. The host when the code cannot read the
 * manifest.
 */
async function installedName(): Promise<string> {
  try {
    // The precached copy. Thus, this works offline and makes no request.
    const res = await caches.match(
      new URL("manifest.webmanifest", self.registration.scope),
      { ignoreSearch: true },
    );
    const { name } = ((await res?.json()) ?? {}) as { name?: unknown };
    if (typeof name === "string" && name.trim()) return name;
  } catch {
    // Not JSON: the host below, as when it is not cached.
  }
  return self.location.host;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const noteId = (event.notification.data as { noteId?: string })?.noteId;
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Only a window of this app. `includeUncontrolled` finds each window of
      // the origin. On a shared origin (a subpath of a Pages site), that
      // includes the pages of other sites, which would get focus and the note.
      const scope = self.registration.scope;
      for (const client of clientList) {
        if ("focus" in client && client.url.startsWith(scope)) {
          client.postMessage({ type: "open-note", noteId });
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        // Against the scope, not the origin. An instance served from a subpath
        // (`/manifesto/` on GitHub Pages) is not at `/`. `App` opens the note
        // named in `?note=` after it starts.
        const url = new URL(self.registration.scope);
        if (noteId) url.searchParams.set("note", noteId);
        await self.clients.openWindow(url.href);
      }
    })(),
  );
});
