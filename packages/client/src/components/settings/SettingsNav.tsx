import {
  Database,
  History,
  Info,
  KeyRound,
  KeySquare,
  type LucideIcon,
  Palette,
  ShieldCheck,
  Sparkles,
  Wallpaper,
  Webhook,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { Avatar } from "#/components/Avatar.tsx";
import { type MessageKey, t } from "#/i18n/index.ts";
import { currentUser, isServerMode } from "#/state/account/auth.ts";
import { hasSecondFactor } from "#/state/account/twoFactor.ts";
import { offeredTokenKinds, serverFeature } from "#/state/serverFeatures.ts";
import type { SettingsTab } from "#/state/ui.ts";
import { hasOwnPassword } from "./AccountSettings.tsx";

type TabInfo = {
  label: MessageKey;
  icon: LucideIcon;
};

export const TABS: Record<Exclude<SettingsTab, "account">, TabInfo> = {
  twoFactor: { label: "twoFactor.title", icon: ShieldCheck },
  keys: { label: "keys.title", icon: KeyRound },
  tokens: { label: "tokens.title", icon: KeySquare },
  webhooks: { label: "webhooks.title", icon: Webhook },
  activity: { label: "activity.title", icon: History },
  appearance: { label: "settings.group.appearance", icon: Palette },
  board: { label: "settings.boardBackground", icon: Wallpaper },
  features: { label: "settings.group.features", icon: Sparkles },
  data: { label: "settings.group.data", icon: Database },
  about: { label: "settings.group.about", icon: Info },
};

export const GENERAL_TABS: SettingsTab[] = [
  "appearance",
  "board",
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
 * none for a feature the server has off (`serverFeature`). The keys are every
 * account's, however it signs in. Two-factor stays
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
  tabs.push("keys");
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

/** Pages that belong together, set apart from the next group by a gap alone. */
export function NavGroup({ children }: { children: ComponentChildren }) {
  return <div class="contents sm:block sm:space-y-0.5 sm:pb-4">{children}</div>;
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
