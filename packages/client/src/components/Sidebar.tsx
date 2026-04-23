import type { LucideIcon } from "lucide-preact";
import {
  Archive,
  Bell,
  Hash,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-preact";
import { t } from "../i18n/index.js";
import {
  type AppView,
  activeTag,
  activeView,
  exitSelectMode,
  selectMode,
} from "../state/index.js";
import { Tooltip } from "./Tooltip.js";

/** Sidebar width when collapsed (icon-only) */
const COLLAPSED_W = 56;

function activateView(view: AppView) {
  activeView.value = view;
  if (view !== "tags") {
    activeTag.value = null;
  }
  if (selectMode.value) {
    exitSelectMode();
  }
}

function DesktopNavItem({
  label,
  icon: Icon,
  view,
}: {
  label: string;
  icon: LucideIcon;
  view: AppView;
}) {
  const isActive = activeView.value === view;

  return (
    <Tooltip label={label}>
      <button
        type="button"
        class={`flex items-center justify-center w-10 h-10 rounded-lg mx-auto transition-colors cursor-pointer ${
          isActive
            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
            : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
        }`}
        onClick={() => activateView(view)}
        aria-label={label}
      >
        <Icon class="w-5 h-5" />
      </button>
    </Tooltip>
  );
}

function MobileNavItem({
  label,
  icon: Icon,
  view,
}: {
  label: string;
  icon: LucideIcon;
  view: AppView;
}) {
  const isActive = activeView.value === view;

  return (
    <button
      type="button"
      class={`flex items-center justify-center w-10 h-10 rounded-lg transition-colors cursor-pointer shrink-0 ${
        isActive
          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
          : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
      }`}
      onClick={() => activateView(view)}
      aria-label={label}
      aria-pressed={isActive}
    >
      <Icon class="w-5 h-5" />
    </button>
  );
}

export function Sidebar() {
  return (
    <div
      class="hidden md:block shrink-0 shadow-[2px_0_8px_rgba(0,0,0,0.08)] dark:shadow-[2px_0_8px_rgba(0,0,0,0.3)] z-[5]"
      style={{ width: `${COLLAPSED_W}px` }}
    >
      <nav class="flex flex-col items-center gap-1 pt-3">
        <DesktopNavItem
          label={t("nav.notes")}
          icon={StickyNote}
          view="active"
        />
        <DesktopNavItem label={t("nav.tags")} icon={Hash} view="tags" />
        <DesktopNavItem
          label={t("nav.reminders")}
          icon={Bell}
          view="reminders"
        />
        <DesktopNavItem
          label={t("nav.autoNotes")}
          icon={Sparkles}
          view="autoNotes"
        />
        <DesktopNavItem
          label={t("nav.archive")}
          icon={Archive}
          view="archived"
        />
        <DesktopNavItem label={t("nav.trash")} icon={Trash2} view="trash" />
      </nav>
    </div>
  );
}

export function MobileNav() {
  return (
    <nav
      class="md:hidden flex items-center justify-around gap-1 px-2 h-12 shrink-0 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm z-[5]"
      aria-label={t("nav.primary")}
    >
      <MobileNavItem label={t("nav.notes")} icon={StickyNote} view="active" />
      <MobileNavItem label={t("nav.tags")} icon={Hash} view="tags" />
      <MobileNavItem label={t("nav.reminders")} icon={Bell} view="reminders" />
      <MobileNavItem
        label={t("nav.autoNotes")}
        icon={Sparkles}
        view="autoNotes"
      />
      <MobileNavItem label={t("nav.archive")} icon={Archive} view="archived" />
      <MobileNavItem label={t("nav.trash")} icon={Trash2} view="trash" />
    </nav>
  );
}
