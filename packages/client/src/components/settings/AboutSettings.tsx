import { ArrowUpCircle, RefreshCw } from "lucide-preact";
import { useState } from "preact/hooks";
import {
  APP_LOGO,
  APP_NAME,
  INSTANCE_LOGO,
  INSTANCE_NAME,
  ORG_LOGO,
  ORG_NAME,
  WELCOME_ENABLED,
} from "../../config.js";
import { t } from "../../i18n/index.js";
import { forceUpdateApp } from "../../serviceWorker.js";
import { availableUpdate } from "../../state/admin.js";
import { currentUser } from "../../state/auth.js";
import { showShortcuts, showWelcome } from "../../state/index.js";
import { BrandLogo } from "../BrandLogo.js";
import { OrgCredit } from "../OrgCredit.js";
import { StorageMode } from "../WelcomeDialog.js";

const linkRowClass =
  "flex items-center gap-2 w-full py-2 text-sm text-left text-blue-700 dark:text-blue-300 hover:underline cursor-pointer";

function ForceUpdate() {
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const handleClick = async () => {
    setBusy(true);
    const reloading = await forceUpdateApp();
    if (!reloading) {
      setOffline(true);
      setBusy(false);
    }
  };
  return (
    <div class="space-y-2">
      <button
        type="button"
        class="px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 rounded-lg font-medium hover:bg-neutral-200 dark:hover:bg-neutral-600 inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        disabled={busy}
        onClick={handleClick}
      >
        <RefreshCw class={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        {t("settings.about.forceUpdate")}
      </button>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        {offline
          ? t("settings.about.forceUpdateOffline")
          : t("settings.about.forceUpdateHint")}
      </p>
    </div>
  );
}

export function AboutSettings({ onClose }: { onClose: () => void }) {
  const user = currentUser.value;
  const update = user?.isAdmin ? availableUpdate.value : null;
  return (
    <div class="space-y-5">
      {/* The app, with its mark and version, then whose copy of it this is.
          The app is always named here, whatever the top bar carries. */}
      <div class="flex items-center gap-3">
        <BrandLogo logo={APP_LOGO} class="w-8 h-8 shrink-0" />
        <div>
          <p class="text-base font-medium">{APP_NAME}</p>
          <p class="text-sm text-neutral-500 dark:text-neutral-400">
            {t("settings.about.version", { version: __APP_VERSION__ })}
          </p>
        </div>
      </div>
      {(INSTANCE_NAME || INSTANCE_LOGO || ORG_NAME || ORG_LOGO) && (
        <div class="space-y-1.5">
          {(INSTANCE_NAME || INSTANCE_LOGO) && (
            <div class="flex items-center gap-2">
              {INSTANCE_LOGO && (
                <BrandLogo
                  logo={INSTANCE_LOGO}
                  class="h-6 w-auto max-w-24 object-contain"
                />
              )}
              {INSTANCE_NAME && <p class="text-sm">{INSTANCE_NAME}</p>}
            </div>
          )}
          <OrgCredit class="justify-start" />
        </div>
      )}
      <StorageMode class="bg-neutral-100 dark:bg-neutral-700/50" />
      <ForceUpdate />
      {update && (
        <a
          class="flex items-center gap-2 p-3 rounded-lg text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 hover:underline"
          href={update.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ArrowUpCircle class="w-4 h-4 shrink-0" />
          {t("account.updateAvailable", { version: update.latest })}
        </a>
      )}
      <div>
        {/* Beside the source it is the licence of. */}
        <p class="pb-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t("settings.about.license")}
        </p>
        <div class="divide-y divide-neutral-200 dark:divide-neutral-700">
          <a
            class={linkRowClass}
            href="https://github.com/TatuArvela/manifesto"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("settings.about.repo")}
          </a>
          {WELCOME_ENABLED && (
            <button
              type="button"
              class={linkRowClass}
              onClick={() => {
                onClose();
                showWelcome.value = true;
              }}
            >
              {t("settings.about.welcome")}
            </button>
          )}
          <button
            type="button"
            class={linkRowClass}
            onClick={() => {
              onClose();
              showShortcuts.value = true;
            }}
          >
            {t("settings.about.shortcuts")}
          </button>
        </div>
      </div>
    </div>
  );
}
