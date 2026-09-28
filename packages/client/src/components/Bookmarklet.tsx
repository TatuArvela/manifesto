import { Bookmark } from "lucide-preact";
import { useState } from "preact/hooks";
import { APP_NAME } from "../config.js";
import { t } from "../i18n/index.js";
import { bookmarkletHref } from "../shareTarget.js";

/**
 * The link to drag to the bookmarks bar: clicked on any page, it opens a new
 * note here with the page's title, address and selected text. The share
 * sheet does the same on a phone with the app installed; this is for the
 * browsers it does not reach.
 *
 * Clicking it here does nothing (this page's CSP runs no `javascript:` URL,
 * and it would only share the app with itself), so a click says where it goes
 * instead.
 */
export function Bookmarklet() {
  const [hinted, setHinted] = useState(false);
  const appUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;

  return (
    <section class="space-y-2">
      <h3 class="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        {t("settings.clip.title")}
      </h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {t("settings.clip.explain")}
      </p>
      <a
        href={bookmarkletHref(appUrl)}
        draggable
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-grab"
        onClick={(e) => {
          e.preventDefault();
          setHinted(true);
        }}
      >
        <Bookmark class="w-4 h-4" />
        {t("settings.clip.link", { appName: APP_NAME })}
      </a>
      {hinted && (
        <p role="status" class="text-xs text-neutral-500 dark:text-neutral-400">
          {t("settings.clip.dragHint")}
        </p>
      )}
    </section>
  );
}
