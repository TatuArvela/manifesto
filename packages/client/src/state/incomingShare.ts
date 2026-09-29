import {
  IMAGE_DATA_URL_PATTERN,
  MAX_IMAGE_DATA_URL_BYTES,
  MAX_IMAGE_SOURCE_BYTES,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { formatFileSize, t } from "../i18n/index.js";
import {
  MAX_SHARED_TEXT,
  SHARE_CACHE,
  SHARE_IMAGE_KEY_PREFIX,
  SHARE_TARGET_PARAM,
  SHARE_TEXT_KEY,
  type SharedText,
  sharedTextToDraft,
} from "../shareTarget.js";
import { shrinkImage } from "../utils/shrinkImage.js";
import { activeTag, activeView, showError } from "./ui.js";

export interface IncomingShare {
  title: string;
  content: string;
  images: string[];
}

/**
 * Something another app shared to this one, waiting for `NoteInput` to open
 * it as a new note. Cleared by whoever takes it.
 */
export const incomingShare = signal<IncomingShare | null>(null);

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Picks up a share the service worker parked (see `shareTarget.ts`) when the
 * app was opened on `?share-target`. The parameter is removed at once, so a
 * reload does not open the same share again, and so is the cache, whatever it
 * held.
 */
export async function takeIncomingShare(): Promise<void> {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SHARE_TARGET_PARAM)) return;
  url.searchParams.delete(SHARE_TARGET_PARAM);
  // A bookmarklet sends the page in the query rather than through the
  // service worker (`bookmarkletHref`).
  const fields = ["title", "text", "url"] as const;
  const inQuery = fields.some((field) => url.searchParams.has(field));
  const queried: SharedText = {
    title: (url.searchParams.get("title") ?? "").slice(0, MAX_SHARED_TEXT),
    text: (url.searchParams.get("text") ?? "").slice(0, MAX_SHARED_TEXT),
    url: (url.searchParams.get("url") ?? "").slice(0, MAX_SHARED_TEXT),
  };
  for (const field of fields) url.searchParams.delete(field);
  history.replaceState(history.state, "", url.href);
  if (inQuery) {
    openShare(sharedTextToDraft(queried), []);
    return;
  }
  if (!("caches" in window)) return;

  const scope = new URL(import.meta.env.BASE_URL, window.location.origin);
  let shared: SharedText | null = null;
  const images: string[] = [];
  try {
    const cache = await caches.open(SHARE_CACHE);
    const text = await cache.match(new URL(SHARE_TEXT_KEY, scope).href);
    if (text) shared = (await text.json()) as SharedText;
    const imagePrefix = new URL(SHARE_IMAGE_KEY_PREFIX, scope).href;
    const keys = (await cache.keys())
      .map((request) => request.url)
      .filter((key) => key.startsWith(imagePrefix))
      .sort(
        (a, b) =>
          Number(a.slice(imagePrefix.length)) -
          Number(b.slice(imagePrefix.length)),
      );
    for (const key of keys) {
      const response = await cache.match(key);
      if (!response) continue;
      const name = decodeURIComponent(
        response.headers.get("X-File-Name") ?? "",
      );
      const dataUrl = await blobToDataUrl(
        await shrinkImage(await response.blob()),
      );
      if (!dataUrl || !IMAGE_DATA_URL_PATTERN.test(dataUrl)) continue;
      if (dataUrl.length > MAX_IMAGE_DATA_URL_BYTES) {
        showError(
          t("editor.imageTooLarge", {
            name,
            size: formatFileSize(MAX_IMAGE_SOURCE_BYTES),
          }),
        );
        continue;
      }
      images.push(dataUrl);
    }
  } catch {
    // Nothing usable was parked; the app simply opens.
  } finally {
    await caches.delete(SHARE_CACHE).catch(() => {});
  }

  const draft = shared
    ? sharedTextToDraft({
        title: String(shared.title ?? ""),
        text: String(shared.text ?? ""),
        url: String(shared.url ?? ""),
      })
    : { title: "", content: "" };
  openShare(draft, images);
}

/** Opens a share as a new note, on the notes view where that editor lives. */
function openShare(
  draft: { title: string; content: string },
  images: string[],
) {
  if (!draft.title && !draft.content && images.length === 0) return;
  activeView.value = "active";
  activeTag.value = null;
  incomingShare.value = { ...draft, images };
}
