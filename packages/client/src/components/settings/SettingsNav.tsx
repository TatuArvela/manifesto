import {
  Database,
  History,
  Info,
  KeySquare,
  type LucideIcon,
  Palette,
  ShieldCheck,
  Sparkles,
  Webhook,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { type MessageKey, t } from "../../i18n/index.js";
import { currentUser, isServerMode } from "../../state/auth.js";
import type { SettingsTab } from "../../state/index.js";
import {
  offeredTokenKinds,
  serverFeature,
} from "../../state/serverFeatures.js";
import { hasSecondFactor } from "../../state/twoFactor.js";
import { Avatar } from "../Avatar.js";
import { hasOwnPassword } from "./AccountSettings.js";

type TabInfo = {
  label: MessageKey;
  icon: LucideIcon;
};

export const TABS: Record<Exclude<SettingsTab, "account">, TabInfo> = {
  twoFactor: { label: "twoFactor.title", icon: ShieldCheck },
  tokens: { label: "tokens.title", icon: KeySquare },
  webhooks: { label: "webhooks.title", icon: Webhook },
  activity: { label: "activity.title", icon: History },
  appearance: { label: "settings.group.appearance", icon: Palette },
  features: { label: "settings.group.features", icon: Sparkles },
  data: { label: "settings.group.data", icon: Database },
  about: { label: "settings.group.about", icon: Info },
};

export const GENERAL_TABS: SettingsTab[] = [
  "appearance",
  "features",
  "data",
  "about",
];

/** Whether the server lets an account add a second factor of either kind. */
export function secondFactorOffered(): boolean {
  return serverFeature("twoFactor") || serverFeature("passkeys");
}

/**
 * The account's pages this user has: none in open mode or signed out, and
 * none for a feature the server has off (`serverFeature`). Two-factor stays
 * while either of its halves is on, and with both off for an account that
 * already has one: sign-in still asks for it, and this page is the only way
 * to remove it.
 */
export function accountTabs(): SettingsTab[] {
  if (!isServerMode || !currentUser.value) return [];
  const tabs: SettingsTab[] = ["account"];
  if (hasOwnPassword() && (secondFactorOffered() || hasSecondFactor())) {
    tabs.push("twoFactor");
  }
  if (offeredTokenKinds().length > 0) tabs.push("tokens");
  if (serverFeature("webhooks")) tabs.push("webhooks");
  tabs.push("activity");
  return tabs;
}

const navItemClass =
  "flex items-center gap-3 shrink-0 sm:w-full px-3 py-2 rounded-lg text-sm text-left whitespace-nowrap cursor-pointer transition-colors";

/** The current page looks as the app's own sidebar marks the current view. */
function navItemState(active: boolean) {
  return active
    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
    : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60";
}

export function NavGroup({
  title,
  children,
}: {
  title?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="contents sm:block sm:space-y-0.5 sm:pb-4">
      {title && (
        <p class="hidden sm:block px-3 pb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

export function NavItem({
  tab,
  active,
  onSelect,
  badge,
}: {
  tab: Exclude<SettingsTab, "account">;
  active: boolean;
  onSelect: (tab: SettingsTab) => void;
  badge?: boolean;
}) {
  const { label, icon: Icon } = TABS[tab];
  return (
    <button
      type="button"
      class={`${navItemClass} ${navItemState(active)}`}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(tab)}
    >
      <Icon class="w-4 h-4 shrink-0" />
      <span class="flex-1">{t(label)}</span>
      {badge && (
        <span class="w-2 h-2 rounded-full bg-blue-500" aria-hidden="true" />
      )}
    </button>
  );
}

/** The signed-in user as the first entry of the sidebar, like a profile card. */
export function AccountNavItem({
  active,
  onSelect,
}: {
  active: boolean;
  onSelect: (tab: SettingsTab) => void;
}) {
  const user = currentUser.value;
  if (!user) return null;
  const name = user.displayName || user.username;
  return (
    <button
      type="button"
      class={`${navItemClass} ${navItemState(active)} sm:py-2.5 sm:mb-1`}
      aria-current={active ? "page" : undefined}
      aria-label={t("account.menu")}
      onClick={() => onSelect("account")}
    >
      <Avatar
        name={name}
        color={user.avatarColor}
        class="w-5 h-5 text-[10px] sm:w-9 sm:h-9 sm:text-sm"
      />
      <span class="sm:hidden">{t("account.menu")}</span>
      <span class="hidden sm:block min-w-0 flex-1">
        <span class="block text-sm font-medium truncate">{name}</span>
        <span
          class={`block text-xs font-normal truncate ${active ? "opacity-75" : "text-neutral-500 dark:text-neutral-400"}`}
        >
          {user.email ?? user.username}
        </span>
      </span>
    </button>
  );
}
