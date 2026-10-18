import { Search, X } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Backdrop } from "#/components/Backdrop.tsx";
import { Bookmarklet } from "#/components/Bookmarklet.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { usePresence } from "#/hooks/usePresence.ts";
import { t } from "#/i18n/index.ts";
import { currentUser, isServerMode } from "#/state/account/auth.ts";
import { twoFactorStatus } from "#/state/account/twoFactor.ts";
import { availableUpdate } from "#/state/admin.ts";
import { type SettingsTab, settingsTab, showSettings } from "#/state/ui.ts";
import { AboutSettings } from "./AboutSettings.tsx";
import { AccountSettings, hasOwnPassword } from "./AccountSettings.tsx";
import { ActivitySettings } from "./ActivitySettings.tsx";
import { ApiTokensSettings } from "./ApiTokensSettings.tsx";
import { AppearanceSettings } from "./AppearanceSettings.tsx";
import { BoardBackgroundSettings } from "./BoardBackgroundSettings.tsx";
import { DataSettings } from "./DataSettings.tsx";
import { FeaturesSettings } from "./FeaturesSettings.tsx";
import { KeysSettings } from "./KeysSettings.tsx";
import { LanguageSettings } from "./LanguageSettings.tsx";
import {
  AccountNavItem,
  accountTabs,
  GENERAL_TABS,
  NavGroup,
  NavItem,
  secondFactorOffered,
  TABS,
} from "./SettingsNav.tsx";
import {
  findSettingRow,
  type SettingsHit,
  searchSettings,
} from "./settingsIndex.ts";
import { TwoFactorSettings } from "./TwoFactorSettings.tsx";
import { WebhooksSettings } from "./WebhooksSettings.tsx";

/** How long the modal's exit runs; matches the `duration-150` classes below. */
const CLOSE_MS = 150;

export function SettingsDialog() {
  const { shown, leaving } = usePresence(showSettings.value || null, CLOSE_MS);
  const isOpen = showSettings.value;

  const handleClose = () => {
    showSettings.value = false;
  };

  const [query, setQuery] = useState("");
  // The setting a search result was chosen for, found on its page once that
  // page has rendered.
  const [jump, setJump] = useState<string | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!jump || !pane) return;
    setJump(null);
    const row = findSettingRow(pane, jump);
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.classList.remove("settings-found");
    // Read between the two so the class coming back restarts the animation.
    void row.offsetWidth;
    row.classList.add("settings-found");
    row.addEventListener(
      "animationend",
      () => row.classList.remove("settings-found"),
      { once: true },
    );
    row
      .querySelector<HTMLElement>("button, input, select, [tabindex]")
      ?.focus({ preventScroll: true });
  }, [jump]);

  // A select menu inside the modal registers after it and closes alone.
  useEscapeStack(isOpen, handleClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);

  // With both halves of two-factor off on the server, its page is only for an
  // account that already has one, and only the server knows whether it does.
  const askForSecondFactor =
    isOpen &&
    isServerMode &&
    currentUser.value !== null &&
    hasOwnPassword() &&
    !secondFactorOffered();
  useEffect(() => {
    if (askForSecondFactor) void twoFactorStatus();
  }, [askForSecondFactor]);

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
  const tabName = (a: SettingsTab) =>
    t(a === "account" ? "account.menu" : TABS[a].label);
  const hits = searchSettings(
    query,
    [...account, ...GENERAL_TABS].map((a) => ({ tab: a, name: tabName(a) })),
  );
  const choose = (hit: SettingsHit) => {
    setQuery("");
    select(hit.tab);
    setJump(hit.label);
  };

  return (
    <>
      <Backdrop
        onDismiss={handleClose}
        closing={leaving}
        class="layer-backdrop"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        class={`fixed inset-0 layer-sheet flex items-center justify-center sm:p-6 pointer-events-none transition-all duration-150 ${leaving ? "opacity-0 scale-95" : "animate-scale-in"}`}
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
            <div class="px-3 pb-2 shrink-0">
              <label class="relative block">
                <span class="sr-only">{t("settings.search")}</span>
                <Search
                  class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    const first = hits[0];
                    if (e.key === "Enter" && first) {
                      e.preventDefault();
                      choose(first);
                    }
                  }}
                  placeholder={t("settings.search")}
                  class="w-full pl-8 pr-2 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-800 ring-1 ring-inset ring-neutral-200 dark:ring-neutral-700 placeholder:text-neutral-400 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
            {query.trim() !== "" ? (
              <section
                aria-label={t("settings.searchResults")}
                aria-live="polite"
                class="flex flex-col gap-0.5 overflow-y-auto max-h-64 sm:max-h-none px-3 pb-3 sm:pb-2"
              >
                {hits.length === 0 ? (
                  <p class="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">
                    {t("settings.searchNone")}
                  </p>
                ) : (
                  hits.map((hit) => (
                    <button
                      key={`${hit.tab}:${hit.label ?? ""}`}
                      type="button"
                      class="flex flex-col items-start w-full px-3 py-2 rounded-lg text-left text-sm cursor-pointer text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60"
                      onClick={() => choose(hit)}
                    >
                      <span>{hit.label ?? tabName(hit.tab)}</span>
                      {hit.label !== null && (
                        <span class="text-xs text-neutral-500 dark:text-neutral-400">
                          {tabName(hit.tab)}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </section>
            ) : (
              <nav
                aria-label={t("settings.title")}
                class="flex sm:flex-col gap-1 sm:gap-0 overflow-x-auto sm:overflow-x-visible sm:overflow-y-auto px-3 pb-3 sm:pb-2"
              >
                {account.length > 0 && (
                  <NavGroup>
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
                <NavGroup>
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
            )}
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
              ref={paneRef}
              class="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5"
            >
              {tab === "account" && <AccountSettings />}
              {tab === "twoFactor" && <TwoFactorSettings />}
              {tab === "keys" && <KeysSettings />}
              {tab === "tokens" && <ApiTokensSettings />}
              {tab === "webhooks" && <WebhooksSettings />}
              {tab === "activity" && <ActivitySettings />}
              {tab === "language" && <LanguageSettings />}
              {tab === "appearance" && <AppearanceSettings />}
              {tab === "board" && <BoardBackgroundSettings />}
              {tab === "features" && <FeaturesSettings />}
              {tab === "data" && <DataSettings />}
              {tab === "clip" && <Bookmarklet />}
              {tab === "about" && <AboutSettings onClose={handleClose} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
