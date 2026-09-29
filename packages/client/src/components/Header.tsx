import { Search, Settings, X } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { HEADER_BRAND, INSTANCE_NAME } from "../config.js";
import { t } from "../i18n/index.js";
import { availableUpdate } from "../state/admin.js";
import { currentUser } from "../state/auth.js";
import {
  activeView,
  exitSearch,
  searchInput,
  selectMode,
  showSettings,
  typeSearch,
} from "../state/index.js";
import { AccountMenu } from "./AccountMenu.js";
import { BrandLogo } from "./BrandLogo.js";
import { SortMenu, ViewMenu } from "./HeaderMenus.js";
import {
  SELECTION_BAR_LEAVE_MS,
  SelectionToolbar,
} from "./SelectionToolbar.js";
import { Tooltip } from "./Tooltip.js";

/**
 * The header's icon buttons, in the same grey as the navigation beside them:
 * the sidebar on desktop, the icon bar under the header on phones. They used
 * to inherit the page's text colour, which made them the darkest thing on the
 * screen next to lighter icons doing the same job.
 */
const headerIconBtnClass =
  "p-2 rounded-lg text-neutral-600 md:text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800";

/**
 * The header, with the selection bar laid over it while notes are selected.
 * Over it rather than instead of it, so the bar can fade out onto the header
 * underneath when select mode ends; swapping one for the other in a frame made
 * leaving select mode the one abrupt change on the board.
 */
export function Header() {
  const selecting = selectMode.value;
  const [barShown, setBarShown] = useState(selecting);
  useEffect(() => {
    if (selecting) {
      setBarShown(true);
      return;
    }
    const timer = setTimeout(() => setBarShown(false), SELECTION_BAR_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [selecting]);

  return (
    <div class="relative z-20 shrink-0">
      <MainHeader covered={selecting} />
      {(selecting || barShown) && <SelectionToolbar leaving={!selecting} />}
    </div>
  );
}

function MainHeader({ covered }: { covered: boolean }) {
  // An admin hears about a new release on the gear, since it is the settings'
  // About page that links to it.
  const updateAvailable =
    currentUser.value?.isAdmin === true && availableUpdate.value !== null;

  const viewTitle = (() => {
    switch (activeView.value) {
      case "active":
        return HEADER_BRAND.name;
      case "tags":
        return t("nav.tags");
      case "reminders":
        return t("nav.reminders");
      case "autoNotes":
        return t("nav.autoNotes");
      case "archived":
        return t("nav.archive");
      case "trash":
        return t("nav.trash");
      case "search":
        return t("nav.search");
      case "admin":
        return t("nav.admin");
      default:
        return "";
    }
  })();

  return (
    <header
      class="relative shadow-md flex items-center border-b border-neutral-200 dark:border-neutral-700 px-2 sm:px-4 min-h-14 pt-[env(safe-area-inset-top)] shrink-0 bg-white dark:bg-neutral-900"
      // Out of reach under the selection bar: its controls would otherwise
      // still take Tab presses and clicks through the gaps between buttons.
      inert={covered}
    >
      {/* Left: logo + title. Logo shows only on the active (main) view,
          matching desktop. Title truncates on md+ so long translations don't
          overlap the centered search bar, which is absolutely centered with
          a max width of 36rem, so the title gets (50vw − 19rem) to grow into
          on wide viewports, or 11rem on narrow md widths where the search
          bar fills the padded area. */}
      <div class="flex items-center gap-2 z-10 pl-1 md:pl-2 min-w-0 md:max-w-[max(11rem,calc(50vw-19rem))]">
        {activeView.value === "active" && HEADER_BRAND.logo && (
          <BrandLogo
            logo={HEADER_BRAND.logo}
            // The app's mark is square; an instance's logo may be a wordmark,
            // so it keeps its own shape up to a limit.
            class={`h-6 shrink-0 ${HEADER_BRAND.isInstance ? "w-auto max-w-24 object-contain" : "w-6"}`}
          />
        )}
        <h1
          class="text-lg font-semibold truncate select-none shrink-0 max-w-full"
          title={viewTitle}
        >
          {viewTitle}
        </h1>
        {/* Which copy of the app this is, beside its name on the Notes view,
            where the name is. It gives way first when the header is tight. */}
        {activeView.value === "active" &&
          INSTANCE_NAME &&
          !HEADER_BRAND.isInstance && (
            <span
              class="text-sm text-neutral-500 dark:text-neutral-400 truncate select-none min-w-0"
              title={INSTANCE_NAME}
            >
              {INSTANCE_NAME}
            </span>
          )}
      </div>

      {/* Center: search bar, absolutely positioned for true centering
          (desktop only; on mobile the search icon button is used instead) */}
      <div class="absolute inset-0 hidden md:flex items-center justify-center pointer-events-none px-48">
        <div class="relative w-full max-w-xl pointer-events-auto">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="search"
            placeholder={t("header.searchPlaceholder")}
            class="w-full pl-10 pr-10 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-neutral-900 outline-none transition text-sm"
            value={searchInput.value}
            onFocus={() => {
              if (activeView.value !== "search") {
                activeView.value = "search";
              }
            }}
            onInput={(e) => {
              const value = (e.target as HTMLInputElement).value;
              typeSearch(value);
              if (value && activeView.value !== "search") {
                activeView.value = "search";
              }
            }}
          />
          {activeView.value === "search" && (
            <Tooltip label={t("search.close")}>
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer"
                onClick={exitSearch}
                aria-label={t("search.close")}
              >
                <X class="w-4 h-4" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div class="flex-1" />

      <div class="flex items-center gap-0.5 shrink-0 z-10">
        <Tooltip label={t("nav.search")}>
          <button
            type="button"
            class={`${headerIconBtnClass} md:hidden`}
            onClick={() => {
              if (activeView.value === "search") {
                exitSearch();
              } else {
                activeView.value = "search";
              }
            }}
            aria-label={t("nav.search")}
            aria-pressed={activeView.value === "search"}
          >
            {activeView.value === "search" ? (
              <X class="w-5 h-5" />
            ) : (
              <Search class="w-5 h-5" />
            )}
          </button>
        </Tooltip>
        {/* Sort button with dropdown, hidden in views with a fixed sort order */}
        {activeView.value !== "trash" &&
          activeView.value !== "reminders" &&
          activeView.value !== "admin" && (
            <SortMenu buttonClass={headerIconBtnClass} />
          )}

        {/* Grid, list and card size only mean something where there are notes */}
        {activeView.value !== "admin" && (
          <ViewMenu buttonClass={headerIconBtnClass} />
        )}

        <Tooltip label={t("header.settings")}>
          <button
            type="button"
            class={headerIconBtnClass}
            onClick={() => {
              showSettings.value = true;
            }}
            aria-label={t("header.settings")}
          >
            <span class="relative block">
              <Settings class="w-5 h-5" />
              {updateAvailable && (
                <span
                  class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-white dark:ring-neutral-900"
                  aria-hidden="true"
                />
              )}
            </span>
          </button>
        </Tooltip>
        <AccountMenu />
      </div>
    </header>
  );
}
