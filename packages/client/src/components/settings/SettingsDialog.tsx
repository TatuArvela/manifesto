import { X } from "lucide-preact";
import { useEscapeStack } from "../../hooks/useEscapeStack.js";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { usePresence } from "../../hooks/usePresence.js";
import { t } from "../../i18n/index.js";
import { availableUpdate } from "../../state/admin.js";
import { currentUser } from "../../state/auth.js";
import {
  type SettingsTab,
  settingsTab,
  showSettings,
} from "../../state/index.js";
import { Backdrop } from "../Backdrop.js";
import { AboutSettings } from "./AboutSettings.js";
import { AccountSettings } from "./AccountSettings.js";
import { ActivitySettings } from "./ActivitySettings.js";
import { ApiTokensSettings } from "./ApiTokensSettings.js";
import { AppearanceSettings } from "./AppearanceSettings.js";
import { DataSettings } from "./DataSettings.js";
import { FeaturesSettings } from "./FeaturesSettings.js";
import {
  AccountNavItem,
  accountTabs,
  GENERAL_TABS,
  NavGroup,
  NavItem,
  TABS,
} from "./SettingsNav.js";
import { TwoFactorSettings } from "./TwoFactorSettings.js";
import { WebhooksSettings } from "./WebhooksSettings.js";

/** How long the modal's exit runs; matches the `duration-150` classes below. */
const CLOSE_MS = 150;

export function SettingsDialog() {
  const { shown, leaving } = usePresence(showSettings.value || null, CLOSE_MS);
  const isOpen = showSettings.value;

  const handleClose = () => {
    showSettings.value = false;
  };

  // A select menu inside the modal registers after it and closes alone.
  useEscapeStack(isOpen, handleClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);

  if (!shown) return null;

  const user = currentUser.value;
  const account = accountTabs();
  // A page that went away (signed out, webhooks turned off) falls back to the
  // first general one rather than showing nothing.
  const tab = [...account, ...GENERAL_TABS].includes(settingsTab.value)
    ? settingsTab.value
    : "appearance";
  const select = (next: SettingsTab) => {
    settingsTab.value = next;
  };
  const update = user?.isAdmin ? availableUpdate.value : null;
  const title = t(tab === "account" ? "account.menu" : TABS[tab].label);

  return (
    <>
      <Backdrop onDismiss={handleClose} closing={leaving} class="z-40" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        class={`fixed inset-0 z-50 flex items-center justify-center sm:p-6 pointer-events-none transition-all duration-150 ${leaving ? "opacity-0 scale-95" : "animate-scale-in"}`}
      >
        <div class="pointer-events-auto flex flex-col sm:flex-row w-full h-full sm:h-[min(42rem,100%)] sm:max-w-3xl overflow-hidden sm:rounded-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-2xl sm:border border-neutral-200 dark:border-neutral-700">
          <aside class="flex flex-col shrink-0 sm:w-64 bg-neutral-50 dark:bg-neutral-900/40 border-b sm:border-b-0 sm:border-r border-neutral-200 dark:border-neutral-700">
            <div class="flex items-center justify-between px-4 sm:px-5 h-14 shrink-0">
              <h2 id="settings-dialog-title" class="text-lg font-semibold">
                {t("settings.title")}
              </h2>
              <button
                type="button"
                class="sm:hidden p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                onClick={handleClose}
                aria-label={t("settings.close")}
              >
                <X class="w-5 h-5" />
              </button>
            </div>
            <nav
              aria-label={t("settings.title")}
              class="flex sm:flex-col gap-1 sm:gap-0 overflow-x-auto sm:overflow-x-visible sm:overflow-y-auto px-3 pb-3 sm:pb-2"
            >
              {account.length > 0 && (
                <NavGroup title={t("account.menu")}>
                  <AccountNavItem
                    active={tab === "account"}
                    onSelect={select}
                  />
                  {account
                    .filter((a) => a !== "account")
                    .map((a) => (
                      <NavItem
                        key={a}
                        tab={a as Exclude<SettingsTab, "account">}
                        active={tab === a}
                        onSelect={select}
                      />
                    ))}
                </NavGroup>
              )}
              <NavGroup
                title={
                  account.length > 0 ? t("settings.group.general") : undefined
                }
              >
                {GENERAL_TABS.map((g) => (
                  <NavItem
                    key={g}
                    tab={g as Exclude<SettingsTab, "account">}
                    active={tab === g}
                    onSelect={select}
                    badge={g === "about" && update !== null}
                  />
                ))}
              </NavGroup>
            </nav>
          </aside>

          <div class="flex flex-col flex-1 min-w-0 min-h-0">
            <div class="hidden sm:flex items-center justify-between px-6 h-14 shrink-0 border-b border-neutral-200 dark:border-neutral-700">
              <h3 class="text-lg font-semibold">{title}</h3>
              <button
                type="button"
                class="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                onClick={handleClose}
                aria-label={t("settings.close")}
              >
                <X class="w-5 h-5" />
              </button>
            </div>
            {/* Keyed on the page, so a new one starts scrolled to the top. */}
            <div
              key={tab}
              class="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5"
            >
              {tab === "account" && <AccountSettings />}
              {tab === "twoFactor" && <TwoFactorSettings />}
              {tab === "tokens" && <ApiTokensSettings />}
              {tab === "webhooks" && <WebhooksSettings />}
              {tab === "activity" && <ActivitySettings />}
              {tab === "appearance" && <AppearanceSettings />}
              {tab === "features" && <FeaturesSettings />}
              {tab === "data" && <DataSettings />}
              {tab === "about" && <AboutSettings onClose={handleClose} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
