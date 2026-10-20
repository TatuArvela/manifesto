import { Bookmark } from "lucide-preact";
import { useState } from "preact/hooks";
import { APP_NAME } from "#/config.ts";
import { t } from "#/i18n/index.ts";
import { bookmarkletHref } from "#/shareTarget.ts";

/**
 * The link to drag to the bookmarks bar, a section of the Features page of
 * Settings under its own heading. When you click it on any page, it opens a new
 * note here with the title, the address and the selected text of the page. The
 * share sheet does the same on a phone with the app installed. This is for the
 * browsers that the share sheet does not reach.
 *
 * A click on it here does nothing (the CSP of this page runs no `javascript:`
 * URL, and it would only share the app with itself). Thus, a click tells where
 * it goes.
 */
export function Bookmarklet() {
  const [hinted, setHinted] = useState(false);
  const appUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;

  return (
    <section class="space-y-2">
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
