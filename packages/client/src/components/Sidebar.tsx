import type { LucideIcon } from "lucide-preact";
import { Archive, Hash, StickyNote, Trash2 } from "lucide-preact";
import {
  type AppView,
  activeTag,
  activeView,
  exitSelectMode,
  mobileSidebarOpen,
  selectMode,
} from "../state/index.js";
import { Tooltip } from "./Tooltip.js";

/** Sidebar width when collapsed (icon-only) */
const COLLAPSED_W = 56;

function NavItem({
  label,
  icon: Icon,
  view,
  collapsed,
}: {
  label: string;
  icon: LucideIcon;
  view: AppView;
  collapsed?: boolean;
}) {
  const isActive = activeView.value === view;

  const handleClick = () => {
    activeView.value = view;
    if (view !== "tags") {
      activeTag.value = null;
    }
    // Exit select mode when navigating away
    if (selectMode.value) {
      exitSelectMode();
    }
    mobileSidebarOpen.value = false;
  };

  if (collapsed) {
    return (
      <Tooltip label={label}>
        <button
          type="button"
          class={`flex items-center justify-center w-10 h-10 rounded-lg mx-auto transition-colors cursor-pointer ${
            isActive
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
              : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
          }`}
          onClick={handleClick}
          aria-label={label}
        >
          <Icon class="w-5 h-5" />
        </button>
      </Tooltip>
    );
  }

  return (
    <button
      type="button"
      class={`flex items-center gap-4 w-full pl-4 pr-3 py-3 transition-colors whitespace-nowrap cursor-pointer ${
        isActive
          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium"
          : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
      }`}
      onClick={handleClick}
    >
      <Icon class="w-5 h-5 shrink-0" />
      <span class="text-sm">{label}</span>
    </button>
  );
}

export function Sidebar() {
  const isMobileOpen = mobileSidebarOpen.value;

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isMobileOpen && (
        <div
          class="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => {
            mobileSidebarOpen.value = false;
          }}
        />
      )}

      {/* Desktop: collapsed sidebar in flow (reserves space) */}
      <div
        class="hidden lg:block shrink-0"
        style={{ width: `${COLLAPSED_W}px` }}
      >
        {/* Collapsed icon buttons */}
        <nav class="flex flex-col items-center gap-1 pt-2">
          <NavItem label="Notes" icon={StickyNote} view="active" collapsed />
          <NavItem label="Tags" icon={Hash} view="tags" collapsed />
          <NavItem label="Archive" icon={Archive} view="archived" collapsed />
          <NavItem label="Trash" icon={Trash2} view="trash" collapsed />
        </nav>
      </div>

      {/* Mobile sidebar: overlay drawer */}
      <nav
        class={`fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col pt-2 overflow-hidden transition-transform duration-200 ease-in-out lg:hidden ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div class="h-14 flex items-center px-5 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold select-none">Manifesto</h2>
        </div>
        <div class="pt-2">
          <NavItem label="Notes" icon={StickyNote} view="active" />
          <NavItem label="Tags" icon={Hash} view="tags" />
          <NavItem label="Archive" icon={Archive} view="archived" />
          <NavItem label="Trash" icon={Trash2} view="trash" />
        </div>
      </nav>
    </>
  );
}
