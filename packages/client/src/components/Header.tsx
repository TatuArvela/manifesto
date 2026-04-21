import type { NoteColor } from "@manifesto/shared";
import {
  Archive,
  ArrowDownUp,
  LayoutDashboard,
  Menu,
  Palette,
  Pin,
  RectangleHorizontal,
  Search,
  Settings,
  Square,
  StretchHorizontal,
  Tag,
  Trash2,
  X,
} from "lucide-preact";
import { useState } from "preact/hooks";
import logoUrl from "../assets/logo.svg";
import { getColorPickerColors, plural, t } from "../i18n/index.js";
import {
  activeView,
  bulkAddTag,
  bulkArchive,
  bulkPin,
  bulkSetColor,
  bulkTrash,
  exitSelectMode,
  mobileSidebarOpen,
  noteSize,
  type SortMode,
  searchQuery,
  selectedNotes,
  selectMode,
  showSettings,
  sortMode,
  viewMode,
} from "../state/index.js";
import { Dropdown } from "./Dropdown.js";
import { TagPicker } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

const selToolbarBtnClass = "p-2 rounded-lg hover:bg-white/10 transition-colors";

function SelectionToolbar() {
  const count = selectedNotes.value.size;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const colors = getColorPickerColors();

  return (
    <header class="relative z-20 shadow-md flex items-center border-b border-gray-200 dark:border-gray-700 px-2 sm:px-4 h-14 shrink-0 bg-blue-600 dark:bg-blue-700 text-white">
      {/* Left: close + count */}
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
      </div>

      <div class="flex-1" />

      {/* Right: actions */}
      <div class="flex items-center gap-0.5 shrink-0">
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

        {/* Tag picker */}
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
          panelClass="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[180px] text-gray-900 dark:text-gray-100"
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

        {/* Color picker */}
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
          panelClass="absolute right-0 top-full mt-1 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex gap-1 z-20"
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
            onClick={() => bulkTrash()}
            aria-label={t("selection.deleteSelected")}
          >
            <Trash2 class="w-5 h-5" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

export function Header() {
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);

  if (selectMode.value) {
    return <SelectionToolbar />;
  }

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: "default", label: t("header.sort.manual") },
    { value: "updated", label: t("header.sort.updated") },
    { value: "created", label: t("header.sort.created") },
  ];

  return (
    <header class="relative z-20 shadow-md flex items-center border-b border-gray-200 dark:border-gray-700 px-2 sm:px-4 h-14 shrink-0 bg-white dark:bg-gray-900">
      {/* Left: hamburger (mobile only) + title */}
      <div class="flex items-center gap-1 shrink-0 z-10">
        <button
          type="button"
          class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden"
          onClick={() => {
            mobileSidebarOpen.value = !mobileSidebarOpen.value;
          }}
          aria-label={t("nav.toggleSidebar")}
        >
          <Menu class="w-5 h-5" />
        </button>

        <h1 class="text-lg font-semibold whitespace-nowrap hidden sm:flex items-center gap-2 lg:ml-2 select-none">
          {activeView.value === "active" && (
            <>
              <img src={logoUrl} alt="" class="h-6 w-6 dark:invert" />
              {t("app.name")}
            </>
          )}
          {activeView.value === "tags" && t("nav.tags")}
          {activeView.value === "archived" && t("nav.archive")}
          {activeView.value === "trash" && t("nav.trash")}
        </h1>
      </div>

      {/* Center: search bar — absolutely positioned for true centering */}
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none px-40 sm:px-48">
        <div class="relative w-full max-w-xl pointer-events-auto">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder={t("header.searchPlaceholder")}
            class="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-gray-900 outline-none transition text-sm"
            value={searchQuery.value}
            onInput={(e) => {
              searchQuery.value = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
      </div>

      {/* Spacer to push right controls to the end */}
      <div class="flex-1" />

      {/* Right: controls */}
      <div class="flex items-center gap-0.5 shrink-0 z-10">
        {/* Sort button with dropdown */}
        <Dropdown
          open={showSortMenu}
          onClose={() => setShowSortMenu(false)}
          trigger={
            <Tooltip label={t("header.sort")}>
              <button
                type="button"
                class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setShowSortMenu(!showSortMenu)}
                aria-label={t("header.sortNotes")}
              >
                <ArrowDownUp class="w-5 h-5" />
              </button>
            </Tooltip>
          }
          panelClass="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[140px]"
        >
          {sortOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              class={`block w-full text-left px-4 py-2 text-sm ${
                sortMode.value === opt.value
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  : "hover:bg-gray-100 dark:hover:bg-gray-700"
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

        {/* View menu with dropdown */}
        <Dropdown
          open={showViewMenu}
          onClose={() => setShowViewMenu(false)}
          trigger={
            <Tooltip label={t("header.view")}>
              <button
                type="button"
                class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setShowViewMenu(!showViewMenu)}
                aria-label={t("header.viewOptions")}
              >
                <LayoutDashboard class="w-5 h-5" />
              </button>
            </Tooltip>
          }
          panelClass="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[160px]"
        >
          <button
            type="button"
            class={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm ${
              viewMode.value === "grid"
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                : "hover:bg-gray-100 dark:hover:bg-gray-700"
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
                : "hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            onClick={() => {
              viewMode.value = "list";
            }}
          >
            <StretchHorizontal class="w-4 h-4" />
            {t("header.view.list")}
          </button>
          <div class="border-t border-gray-200 dark:border-gray-700 my-1" />
          <button
            type="button"
            class={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm ${
              noteSize.value === "square"
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                : "hover:bg-gray-100 dark:hover:bg-gray-700"
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
                : "hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            onClick={() => {
              noteSize.value = "fit";
            }}
          >
            <RectangleHorizontal class="w-4 h-4" />
            {t("header.view.fit")}
          </button>
        </Dropdown>

        <Tooltip label={t("header.settings")}>
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => {
              showSettings.value = true;
            }}
            aria-label={t("header.settings")}
          >
            <Settings class="w-5 h-5" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
