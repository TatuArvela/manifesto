import {
  ArrowDownUp,
  Grid2x2,
  Grid3x3,
  LayoutDashboard,
  RectangleHorizontal,
  Square,
  StretchHorizontal,
} from "lucide-preact";
import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import {
  noteScale,
  noteSize,
  type SortMode,
  sortMode,
  viewMode,
} from "../state/index.js";
import { Dropdown } from "./Dropdown.js";
import { Tooltip } from "./Tooltip.js";

/** The header's sort order menu. */
export function SortMenu({ buttonClass }: { buttonClass: string }) {
  const [showSortMenu, setShowSortMenu] = useState(false);

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: "default", label: t("header.sort.manual") },
    { value: "updated", label: t("header.sort.updated") },
    { value: "created", label: t("header.sort.created") },
  ];

  return (
    <Dropdown
      open={showSortMenu}
      onClose={() => setShowSortMenu(false)}
      trigger={
        <Tooltip label={t("header.sort")}>
          <button
            type="button"
            class={buttonClass}
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
  );
}

/** The header's layout menu: grid or list, card shape, and card size. */
export function ViewMenu({ buttonClass }: { buttonClass: string }) {
  const [showViewMenu, setShowViewMenu] = useState(false);

  return (
    <Dropdown
      open={showViewMenu}
      onClose={() => setShowViewMenu(false)}
      trigger={
        <Tooltip label={t("header.view")}>
          <button
            type="button"
            class={buttonClass}
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
      {viewMode.value === "grid" && (
        <>
          <div class="border-t border-neutral-200 dark:border-neutral-700 my-1" />
          <button
            type="button"
            class={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm ${
              noteScale.value === "big"
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
            }`}
            onClick={() => {
              noteScale.value = "big";
            }}
          >
            <Grid2x2 class="w-4 h-4" />
            {t("header.view.big")}
          </button>
          <button
            type="button"
            class={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm ${
              noteScale.value === "small"
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
            }`}
            onClick={() => {
              noteScale.value = "small";
            }}
          >
            <Grid3x3 class="w-4 h-4" />
            {t("header.view.small")}
          </button>
        </>
      )}
    </Dropdown>
  );
}
