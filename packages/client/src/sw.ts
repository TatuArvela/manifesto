/// <reference lib="webworker" />
import type { ReminderRecurrence } from "@manifesto/shared";
import { nextOccurrence, parseLocalISO } from "./state/reminderTime.js";

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
};

interface StoredReminder {
  noteId: string;
  time: string;
  recurrence: ReminderRecurrence;
  title: string;
  body: string;
  lastFiredAt: string | null;
}

const DB_NAME = "manifesto-reminders";
const STORE = "reminders";
const PERIODIC_TAG = "check-reminders";
const DEDUPE_WINDOW_MS = 60_000;
const POLL_INTERVAL_MS = 60_000;

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
    const dueMs = parseLocalISO(item.time).getTime() - now;
    if (dueMs > 0) continue;
    if (
      item.lastFiredAt &&
      now - new Date(item.lastFiredAt).getTime() < DEDUPE_WINDOW_MS
    ) {
      continue;
    }
    try {
      await self.registration.showNotification(item.title, {
        body: item.body,
        tag: item.noteId,
        data: { noteId: item.noteId },
      });
    } catch {
      // Browser may reject if permission isn't actually granted; skip silently.
      continue;
    }
    const nowIso = new Date().toISOString();
    const next = nextOccurrence(item.time, item.recurrence);
    if (next) {
      await putOne({ ...item, time: next, lastFiredAt: nowIso });
    } else {
      await putOne({ ...item, lastFiredAt: nowIso });
    }
    broadcast({ type: "reminder-fired", noteId: item.noteId, nextTime: next });
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
        // periodicSync may be unavailable or denied — fall back to polling.
      }
      await fireDue();
      schedulePoll();
    })(),
  );
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as
    | { type: "sync-reminders"; reminders: StoredReminder[] }
    | { type: "delete-reminder"; noteId: string }
    | undefined;
  if (!data) return;
  if (data.type === "sync-reminders") {
    event.waitUntil(replaceAll(data.reminders).then(() => fireDue()));
  } else if (data.type === "delete-reminder") {
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const noteId = (event.notification.data as { noteId?: string })?.noteId;
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ("focus" in client) {
          client.postMessage({ type: "open-note", noteId });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(`/?note=${noteId ?? ""}`);
      }
    })(),
  );
});
