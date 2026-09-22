import type { NoteColor } from "@manifesto/shared";
import {
  Archive,
  ArrowDownUp,
  CheckSquare,
  LayoutDashboard,
  Palette,
  Pin,
  RectangleHorizontal,
  Search,
  Settings,
  Square,
  StretchHorizontal,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { APP_LOGO_URL, APP_NAME } from "../config.js";
import { getColorPickerColors, plural, t } from "../i18n/index.js";
import { askConfirmation } from "../state/confirm.js";
import {
  activeView,
  bulkAddTag,
  bulkArchive,
  bulkDelete,
  bulkPin,
  bulkRestore,
  bulkSetColor,
  bulkTrash,
  exitSearch,
  exitSelectMode,
  noteSize,
  type SortMode,
  searchInput,
  selectAllVisible,
  selectedNotes,
  selectMode,
  showSettings,
  sortedNotes,
  sortMode,
  typeSearch,
  viewMode,
} from "../state/index.js";
import { AccountMenu } from "./AccountMenu.js";
import { Dropdown } from "./Dropdown.js";
import { TagPicker } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

const selToolbarBtnClass = "p-2 rounded-lg hover:bg-white/10 transition-colors";

/** How long the selection bar takes to fade out; `selection-bar-out` in CSS. */
const SELECTION_BAR_LEAVE_MS = 180;

function SelectionToolbar({ leaving }: { leaving: boolean }) {
  // Leaving select mode empties the selection in the same step, so the count
  // is held at what it was while the bar fades rather than reading "0".
  const liveCount = selectedNotes.value.size;
  const heldCount = useRef(liveCount);
  if (!leaving) heldCount.current = liveCount;
  const count = heldCount.current;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const colors = getColorPickerColors();
  const isTrashView = activeView.value === "trash";
  const visibleIds = sortedNotes.value.map((n) => n.id);
  const allSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedNotes.value.has(id));

  // A bulk deletion asks whatever the Confirm Deletions preference says. The
  // preference is about the cost of being asked on a single note; nothing here
  // acts on fewer than the whole selection, and a selection is easy to grow by
  // one card without noticing.
  const askThenDelete = async (
    key: "bulkTrash" | "bulkDelete",
    run: () => void,
  ) => {
    const ok = await askConfirmation({
      title: plural(`confirm.${key}.title`, count),
      body: t(`confirm.${key}.body`),
      confirmLabel: t(
        key === "bulkTrash" ? "confirm.trash.action" : "confirm.delete.action",
      ),
    });
    if (ok) run();
  };

  return (
    <div
      class={`selection-bar absolute inset-0 z-30 shadow-md flex items-center border-b border-neutral-200 dark:border-neutral-700 px-2 sm:px-4 pt-[env(safe-area-inset-top)] bg-blue-600 dark:bg-blue-700 text-white${leaving ? " pointer-events-none" : ""}`}
      data-leaving={leaving ? "true" : undefined}
    >
      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          class="p-2 rounded-lg hover:bg-white/10"
          onClick={() => exitSelectMode()}
          aria-label={t("selection.cancel")}
        >
          <X class="w-5 h-5" />
        </button>
        <span class="text-sm font-medium select-none">
          {plural("selection.count", count)}
        </span>
        <Tooltip
          label={
            allSelected ? t("selection.deselectAll") : t("selection.selectAll")
          }
        >
          <button
            type="button"
            class={selToolbarBtnClass}
            onClick={() => selectAllVisible()}
            aria-label={
              allSelected
                ? t("selection.deselectAll")
                : t("selection.selectAll")
            }
            aria-pressed={allSelected}
          >
            <CheckSquare class="w-5 h-5" />
          </button>
        </Tooltip>
      </div>

      <div class="flex-1" />

      <div class="flex items-center gap-0.5 shrink-0">
        {isTrashView ? (
          <>
            <Tooltip label={t("selection.restore")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => bulkRestore()}
                aria-label={t("selection.restoreSelected")}
              >
                <Undo2 class="w-5 h-5" />
              </button>
            </Tooltip>

            <Tooltip label={t("selection.deletePermanently")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => askThenDelete("bulkDelete", bulkDelete)}
                aria-label={t("selection.deleteSelectedPermanently")}
              >
                <Trash2 class="w-5 h-5" />
              </button>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip label={t("selection.pin")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => bulkPin()}
                aria-label={t("selection.pinSelected")}
              >
                <Pin class="w-5 h-5" />
              </button>
            </Tooltip>

            <Dropdown
              open={showTagPicker}
              onClose={() => setShowTagPicker(false)}
              trigger={
                <Tooltip label={t("selection.addTag")}>
                  <button
                    type="button"
                    class={selToolbarBtnClass}
                    onClick={() => {
                      setShowTagPicker(!showTagPicker);
                      setShowColorPicker(false);
                    }}
                    aria-label={t("selection.tagSelected")}
                  >
                    <Tag class="w-5 h-5" />
                  </button>
                </Tooltip>
              }
              placement="bottom-end"
              panelClass="py-1 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-[180px] text-neutral-900 dark:text-neutral-100"
            >
              <TagPicker
                tags={[]}
                onAddTag={(tag) => {
                  bulkAddTag(tag);
                  setShowTagPicker(false);
                }}
              />
            </Dropdown>

            <Tooltip label={t("selection.archive")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => bulkArchive()}
                aria-label={t("selection.archiveSelected")}
              >
                <Archive class="w-5 h-5" />
              </button>
            </Tooltip>

            <Dropdown
              open={showColorPicker}
              onClose={() => setShowColorPicker(false)}
              trigger={
                <Tooltip label={t("selection.color")}>
                  <button
                    type="button"
                    class={selToolbarBtnClass}
                    onClick={() => {
                      setShowColorPicker(!showColorPicker);
                      setShowTagPicker(false);
                    }}
                    aria-label={t("selection.changeColor")}
                  >
                    <Palette class="w-5 h-5" />
                  </button>
                </Tooltip>
              }
              placement="bottom-end"
              panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
            >
              {colors.map((c) => (
                <Tooltip key={c.value} label={c.label}>
                  <button
                    type="button"
                    class={`w-7 h-7 rounded-full cursor-pointer ${c.swatch}`}
                    onClick={() => {
                      bulkSetColor(c.value as NoteColor);
                      setShowColorPicker(false);
                    }}
                    aria-label={c.label}
                  />
                </Tooltip>
              ))}
            </Dropdown>

            <Tooltip label={t("selection.delete")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => askThenDelete("bulkTrash", bulkTrash)}
                aria-label={t("selection.deleteSelected")}
              >
                <Trash2 class="w-5 h-5" />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}

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
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: "default", label: t("header.sort.manual") },
    { value: "updated", label: t("header.sort.updated") },
    { value: "created", label: t("header.sort.created") },
  ];

  const viewTitle = (() => {
    switch (activeView.value) {
      case "active":
        return APP_NAME;
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
        {activeView.value === "active" && (
          <img src={APP_LOGO_URL} alt="" class="h-6 w-6 shrink-0 dark:invert" />
        )}
        <h1
          class="text-lg font-semibold truncate select-none"
          title={viewTitle}
        >
          {viewTitle}
        </h1>
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
            <Dropdown
              open={showSortMenu}
              onClose={() => setShowSortMenu(false)}
              trigger={
                <Tooltip label={t("header.sort")}>
                  <button
                    type="button"
                    class={headerIconBtnClass}
                    onClick={() => setShowSortMenu(!showSortMenu)}
                    aria-label={t("header.sortNotes")}
                  >
                    <ArrowDownUp class="w-5 h-5" />
                  </button>
                </Tooltip>
              }
              placement="bottom-end"
              panelClass="py-1 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-[140px]"
            >
              {sortOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  class={`block w-full text-left px-4 py-2 text-sm ${
                    sortMode.value === opt.value
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  }`}
                  onClick={() => {
                    sortMode.value = opt.value;
                    setShowSortMenu(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </Dropdown>
          )}

        {/* Grid, list and card size only mean something where there are notes */}
        {activeView.value !== "admin" && (
          <Dropdown
            open={showViewMenu}
            onClose={() => setShowViewMenu(false)}
            trigger={
              <Tooltip label={t("header.view")}>
                <button
                  type="button"
                  class={headerIconBtnClass}
                  onClick={() => setShowViewMenu(!showViewMenu)}
                  aria-label={t("header.viewOptions")}
                >
                  <LayoutDashboard class="w-5 h-5" />
                </button>
              </Tooltip>
            }
            placement="bottom-end"
            panelClass="py-1 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-[160px]"
          >
            <button
              type="button"
              class={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm ${
                viewMode.value === "grid"
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
              onClick={() => {
                viewMode.value = "grid";
              }}
            >
              <LayoutDashboard class="w-4 h-4" />
              {t("header.view.grid")}
            </button>
            <button
              type="button"
              class={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm ${
                viewMode.value === "list"
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
              onClick={() => {
                viewMode.value = "list";
              }}
            >
              <StretchHorizontal class="w-4 h-4" />
              {t("header.view.list")}
            </button>
            <div class="border-t border-neutral-200 dark:border-neutral-700 my-1" />
            <button
              type="button"
              class={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm ${
                noteSize.value === "square"
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
              onClick={() => {
                noteSize.value = "square";
              }}
            >
              <Square class="w-4 h-4" />
              {t("header.view.square")}
            </button>
            <button
              type="button"
              class={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm ${
                noteSize.value === "fit"
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
              onClick={() => {
                noteSize.value = "fit";
              }}
            >
              <RectangleHorizontal class="w-4 h-4" />
              {t("header.view.fit")}
            </button>
          </Dropdown>
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
            <Settings class="w-5 h-5" />
          </button>
        </Tooltip>
        <AccountMenu />
      </div>
    </header>
  );
}
