import {
  ArrowDownUp,
  LayoutDashboard,
  Menu,
  RectangleHorizontal,
  Search,
  Settings,
  Square,
  StretchHorizontal,
} from "lucide-preact";
import { useState } from "preact/hooks";
import {
  activeView,
  mobileSidebarOpen,
  noteSize,
  type SortMode,
  searchQuery,
  showSettings,
  sortMode,
  viewMode,
} from "../state/index.js";
import { Tooltip } from "./Tooltip.js";

const sortOptions: { value: SortMode; label: string }[] = [
  { value: "default", label: "Manual order" },
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Newest first" },
];

export function Header() {
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);

  return (
    <header class="relative flex items-center border-b border-gray-200 dark:border-gray-700 px-2 sm:px-4 h-14 shrink-0">
      {/* Left: hamburger (mobile only) + title */}
      <div class="flex items-center gap-1 shrink-0 z-10">
        <button
          type="button"
          class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden"
          onClick={() => {
            mobileSidebarOpen.value = !mobileSidebarOpen.value;
          }}
          aria-label="Toggle sidebar"
        >
          <Menu class="w-5 h-5" />
        </button>

        <h1 class="text-lg font-semibold whitespace-nowrap hidden sm:block lg:ml-2 select-none">
          {activeView.value === "active" && "Manifesto"}
          {activeView.value === "tags" && "Tags"}
          {activeView.value === "archived" && "Archive"}
          {activeView.value === "trash" && "Trash"}
        </h1>
      </div>

      {/* Center: search bar — absolutely positioned for true centering */}
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none px-40 sm:px-48">
        <div class="relative w-full max-w-xl pointer-events-auto">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder="Search notes..."
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
        <div class="relative">
          <Tooltip label="Sort">
            <button
              type="button"
              class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setShowSortMenu(!showSortMenu)}
              aria-label="Sort notes"
            >
              <ArrowDownUp class="w-5 h-5" />
            </button>
          </Tooltip>
          {showSortMenu && (
            <>
              <div
                class="fixed inset-0 z-10"
                onClick={() => setShowSortMenu(false)}
              />
              <div class="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[140px]">
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
              </div>
            </>
          )}
        </div>

        {/* View menu with dropdown */}
        <div class="relative">
          <Tooltip label="View">
            <button
              type="button"
              class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setShowViewMenu(!showViewMenu)}
              aria-label="View options"
            >
              <LayoutDashboard class="w-5 h-5" />
            </button>
          </Tooltip>
          {showViewMenu && (
            <>
              <div
                class="fixed inset-0 z-10"
                onClick={() => setShowViewMenu(false)}
              />
              <div class="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[160px]">
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
                  Grid view
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
                  List view
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
                  Square notes
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
                  Fit notes
                </button>
              </div>
            </>
          )}
        </div>

        <Tooltip label="Settings">
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => {
              showSettings.value = true;
            }}
            aria-label="Settings"
          >
            <Settings class="w-5 h-5" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
